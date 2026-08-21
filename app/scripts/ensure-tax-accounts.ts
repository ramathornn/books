import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

/**
 * Idempotently wire up the Wave-3 tax modules' chart-of-accounts + CompanySettings.
 *
 * Locked user decisions baked in (see docs/wave3-tax-design.md §0, §6):
 *   - T5 declared dividends are recorded via a NEW "3300 Dividends Declared"
 *     account (equity, contra-equity / debit-normal). The T5 auto-pull reads JE
 *     debits to this account. CompanySettings.dividendsDeclaredAccountId points
 *     here.
 *   - T4A subcontractor fees auto-pull from Expense / BillLineItem lines scoped
 *     to a single subcontractor / professional-fees expense account, with a
 *     per-vendor Vendor.isContractor override. CompanySettings
 *     .subcontractorExpenseAccountId points there.
 *   - Fiscal year-end = Dec 31 (fiscalYearEndMonth=12, fiscalYearEndDay=31) —
 *     drives the CCA JE entryDate and the half-year rule.
 *
 * Behaviour (mirrors scripts/ensure-fx-accounts.ts):
 *   - "3300 Dividends Declared": if absent, create it (class 'equity',
 *     subclass/detailType 'Equity'). If present, assert accountClass==='equity';
 *     if it is some other class, ABORT LOUDLY (do not mutate) — a human must
 *     reconcile.
 *   - Subcontractor expense account: resolved, never created. Resolution order:
 *       1. existing CompanySettings.subcontractorExpenseAccountId (if still valid)
 *       2. SUBCONTRACTOR_ACCOUNT_NUMBER env override (exact account number)
 *       3. an expense account whose name matches /subcontract|professional fee/i
 *     If it cannot be resolved, the script PROMPTS (warns + leaves the setting
 *     null) rather than guessing — T4A auto-pull stays disabled until set.
 *   - ITC receivable: best-effort resolve account 2315 (the established GST
 *     single-account convention) for defaultItcReceivableAccountId; warn if
 *     absent, never create.
 *   - CompanySettings singleton is upserted with the resolved ids +
 *     fiscalYearEndMonth/Day. Existing non-null wiring is preserved (only
 *     null/empty fields are filled).
 *   - `--check` validates only; it never creates or writes.
 *
 * This script does NOT run migrations and does NOT seed recipients. It only
 * touches GLAccount 3300 and the CompanySettings singleton. It is written to be
 * run manually (npx tsx scripts/ensure-tax-accounts.ts [--check]); it is NOT
 * executed as part of any automated build.
 */

const DIVIDENDS_ACCOUNT_NUMBER = '3300'
const DIVIDENDS_ACCOUNT_NAME = 'Dividends Declared'
const DIVIDENDS_ACCOUNT_CLASS = 'equity'
const DIVIDENDS_ACCOUNT_SUBCLASS = 'Equity'
const DIVIDENDS_DETAIL_TYPE = 'Equity'
const DIVIDENDS_DESCRIPTION =
  'Contra-equity account for dividends declared (debit-normal). Source for the T5 auto-pull.'

const ITC_RECEIVABLE_ACCOUNT_NUMBER = '2315'

const FISCAL_YEAR_END_MONTH = 12
const FISCAL_YEAR_END_DAY = 31

type ResolvedAccount = { id: string; accountNumber: string; accountName: string }

async function ensureDividendsAccount(checkOnly: boolean): Promise<ResolvedAccount> {
  const existing = await prisma.gLAccount.findFirst({
    where: { accountNumber: DIVIDENDS_ACCOUNT_NUMBER },
  })

  if (existing) {
    if (existing.accountClass !== DIVIDENDS_ACCOUNT_CLASS) {
      throw new Error(
        `Account ${DIVIDENDS_ACCOUNT_NUMBER} ("${existing.accountName}") exists but is class ` +
          `'${existing.accountClass}', expected '${DIVIDENDS_ACCOUNT_CLASS}'. ` +
          `Refusing to mutate — resolve this manually before the T5 dividend flow goes live.`
      )
    }
    console.log(
      `  ✓ Account ${DIVIDENDS_ACCOUNT_NUMBER} present and valid: "${existing.accountName}" (${existing.accountClass})`
    )
    return existing
  }

  if (checkOnly) {
    throw new Error(
      `Account ${DIVIDENDS_ACCOUNT_NUMBER} ("${DIVIDENDS_ACCOUNT_NAME}") is MISSING. ` +
        `Run ensure-tax-accounts without --check to create it.`
    )
  }

  const created = await prisma.gLAccount.create({
    data: {
      accountNumber: DIVIDENDS_ACCOUNT_NUMBER,
      accountName: DIVIDENDS_ACCOUNT_NAME,
      description: DIVIDENDS_DESCRIPTION,
      accountClass: DIVIDENDS_ACCOUNT_CLASS,
      accountSubclass: DIVIDENDS_ACCOUNT_SUBCLASS,
      detailType: DIVIDENDS_DETAIL_TYPE,
      currency: 'CAD',
      isActive: true,
    },
  })
  console.log(
    `  ✓ Created account ${created.accountNumber} "${created.accountName}" (${created.accountClass})`
  )
  return created
}

/**
 * Resolve (never create) the subcontractor / professional-fees expense account
 * that scopes the T4A Box-048 auto-pull. Returns null if it cannot be resolved
 * confidently — the caller leaves the setting null and prompts.
 */
async function resolveSubcontractorAccount(
  existingSettingId: string | null
): Promise<ResolvedAccount | null> {
  // 1. Honour an already-configured, still-valid setting.
  if (existingSettingId) {
    const acct = await prisma.gLAccount.findUnique({ where: { id: existingSettingId } })
    if (acct) {
      console.log(
        `  ✓ subcontractorExpenseAccountId already set: ${acct.accountNumber} "${acct.accountName}"`
      )
      return acct
    }
    console.warn(
      `  ! subcontractorExpenseAccountId pointed to a missing account (${existingSettingId}); re-resolving.`
    )
  }

  // 2. Explicit env override by exact account number.
  const envNumber = process.env.SUBCONTRACTOR_ACCOUNT_NUMBER?.trim()
  if (envNumber) {
    const acct = await prisma.gLAccount.findFirst({ where: { accountNumber: envNumber } })
    if (acct) {
      if (acct.accountClass !== 'expense') {
        console.warn(
          `  ! SUBCONTRACTOR_ACCOUNT_NUMBER=${envNumber} resolves to "${acct.accountName}" ` +
            `which is class '${acct.accountClass}', not 'expense'. Using it anyway as requested.`
        )
      }
      console.log(
        `  ✓ subcontractor account resolved by env override: ${acct.accountNumber} "${acct.accountName}"`
      )
      return acct
    }
    console.warn(`  ! SUBCONTRACTOR_ACCOUNT_NUMBER=${envNumber} matched no account.`)
  }

  // 3. Heuristic: an expense account named like subcontractor / professional fees.
  const candidates = await prisma.gLAccount.findMany({
    where: {
      accountClass: 'expense',
      OR: [
        { accountName: { contains: 'subcontract', mode: 'insensitive' } },
        { accountName: { contains: 'professional fee', mode: 'insensitive' } },
        { accountName: { contains: 'contractor', mode: 'insensitive' } },
      ],
    },
    orderBy: { accountNumber: 'asc' },
  })

  if (candidates.length === 1) {
    const acct = candidates[0]
    console.log(
      `  ✓ subcontractor account resolved by name: ${acct.accountNumber} "${acct.accountName}"`
    )
    return acct
  }

  if (candidates.length > 1) {
    console.warn(
      `  ! Multiple subcontractor/professional-fees candidates found — refusing to guess:`
    )
    for (const c of candidates) console.warn(`      ${c.accountNumber}  "${c.accountName}"`)
    console.warn(
      `    Set SUBCONTRACTOR_ACCOUNT_NUMBER=<number> (or CompanySettings` +
        `.subcontractorExpenseAccountId directly) and re-run. T4A auto-pull stays disabled until then.`
    )
    return null
  }

  console.warn(
    `  ! No subcontractor / professional-fees expense account found. ` +
      `Set SUBCONTRACTOR_ACCOUNT_NUMBER=<number> and re-run to enable the T4A Box-048 auto-pull.`
  )
  return null
}

/** Best-effort resolve (never create) the ITC receivable account (2315 convention). */
async function resolveItcReceivableAccount(
  existingSettingId: string | null
): Promise<ResolvedAccount | null> {
  if (existingSettingId) {
    const acct = await prisma.gLAccount.findUnique({ where: { id: existingSettingId } })
    if (acct) {
      console.log(
        `  ✓ defaultItcReceivableAccountId already set: ${acct.accountNumber} "${acct.accountName}"`
      )
      return acct
    }
  }
  const acct = await prisma.gLAccount.findFirst({
    where: { accountNumber: ITC_RECEIVABLE_ACCOUNT_NUMBER },
  })
  if (acct) {
    console.log(
      `  ✓ ITC receivable resolved: ${acct.accountNumber} "${acct.accountName}"`
    )
    return acct
  }
  console.warn(
    `  ! Account ${ITC_RECEIVABLE_ACCOUNT_NUMBER} (GST/ITC) not found; ` +
      `leaving defaultItcReceivableAccountId unset.`
  )
  return null
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  console.log(`ensure-tax-accounts ${checkOnly ? '(--check, read-only)' : ''}`)
  console.log('  DB:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))

  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })

  const dividends = await ensureDividendsAccount(checkOnly)
  const subcontractor = await resolveSubcontractorAccount(
    settings?.subcontractorExpenseAccountId ?? null
  )
  const itc = await resolveItcReceivableAccount(settings?.defaultItcReceivableAccountId ?? null)

  // Fill only null/empty fields; never clobber existing non-null wiring.
  const data: Record<string, unknown> = {
    dividendsDeclaredAccountId: settings?.dividendsDeclaredAccountId ?? dividends.id,
    subcontractorExpenseAccountId:
      settings?.subcontractorExpenseAccountId ?? subcontractor?.id ?? null,
    defaultItcReceivableAccountId: settings?.defaultItcReceivableAccountId ?? itc?.id ?? null,
    fiscalYearEndMonth: settings?.fiscalYearEndMonth ?? FISCAL_YEAR_END_MONTH,
    fiscalYearEndDay: settings?.fiscalYearEndDay ?? FISCAL_YEAR_END_DAY,
  }

  if (checkOnly) {
    console.log('  (check) would set CompanySettings:')
    console.log('    dividendsDeclaredAccountId    =', data.dividendsDeclaredAccountId)
    console.log('    subcontractorExpenseAccountId =', data.subcontractorExpenseAccountId)
    console.log('    defaultItcReceivableAccountId =', data.defaultItcReceivableAccountId)
    console.log('    fiscalYearEndMonth/Day        =', data.fiscalYearEndMonth, '/', data.fiscalYearEndDay)
    if (!data.subcontractorExpenseAccountId) {
      throw new Error(
        'subcontractorExpenseAccountId is unresolved — T4A auto-pull would be disabled. ' +
          'Set SUBCONTRACTOR_ACCOUNT_NUMBER and re-run.'
      )
    }
    return
  }

  await prisma.companySettings.upsert({
    where: { id: 'singleton' },
    update: data,
    create: { id: 'singleton', ...data },
  })

  console.log('  ✓ CompanySettings updated:')
  console.log('    dividendsDeclaredAccountId    =', data.dividendsDeclaredAccountId)
  console.log('    subcontractorExpenseAccountId =', data.subcontractorExpenseAccountId)
  console.log('    defaultItcReceivableAccountId =', data.defaultItcReceivableAccountId)
  console.log('    fiscalYearEndMonth/Day        =', data.fiscalYearEndMonth, '/', data.fiscalYearEndDay)
  if (!data.subcontractorExpenseAccountId) {
    console.warn(
      '  ! NOTE: subcontractorExpenseAccountId is still null — set it before filing T4A slips.'
    )
  }
}

main()
  .catch((e) => {
    console.error('ensure-tax-accounts FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
