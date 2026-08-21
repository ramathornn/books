import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import { GIFI_RETAINED_EARNINGS } from '@/lib/tax/t2/gifiCodes'

const prisma = new PrismaClient()

/**
 * Idempotently set CONSERVATIVE CRA GIFI (General Index of Financial Information)
 * defaults on the chart of accounts, ONLY for accounts whose mapping is
 * unambiguous. Everything else is left null for the accountant to complete.
 *
 * GIFI codes are the standard 4-digit identifiers the CRA uses to roll a trial
 * balance up into a T2 corporate return (Schedule 100 balance sheet / Schedule
 * 125 income statement). Tax software (TaxCycle, ProFile) imports a TB keyed by
 * these codes.
 *
 * IMPORTANT — this is deliberately a thin, safe seed:
 *   - We only auto-assign codes that are essentially universal across small-corp
 *     charts (cash, A/R, A/P, GST/HST payable, retained earnings, common shares,
 *     trade sales, interest/other income).
 *   - We NEVER guess a specific expense GIFI. The detailed expense codes
 *     (8521 advertising, 8690 insurance, 8710 interest, 8810 office, 9060
 *     salaries, 9281 vehicle, ...) vary account-by-account and a wrong code
 *     silently misstates the return. Those are left null on purpose.
 *   - We never overwrite a gifiCode that is already set. The accountant's manual
 *     mapping always wins.
 *
 * The accountant should confirm and COMPLETE the mapping from the prior-year T2
 * (match each TB account to the GIFI line used last year). Treat the defaults
 * below as a starting point, not gospel.
 *
 * Heuristics are keyed off accountNumber ranges, accountClass, accountSubclass
 * and accountName — whatever is least likely to misfire. When in doubt, skip.
 *
 * Run manually:
 *   npx tsx scripts/ensure-gifi-codes.ts --check   (read-only; reports proposed changes, writes nothing)
 *   npx tsx scripts/ensure-gifi-codes.ts           (applies the proposed changes)
 *
 * This script does NOT run migrations and is NOT part of any automated build.
 */

// --- Conservative GIFI constants (only the "safe" ones) ----------------------
const GIFI = {
  CASH: '1001', // Cash and deposits
  ACCOUNTS_RECEIVABLE: '1060', // Trade accounts receivable
  ACCOUNTS_PAYABLE: '2620', // Trade accounts payable / accrued liabilities
  GST_HST_PAYABLE: '2680', // Taxes payable (GST/HST owing)
  // Retained earnings / deficit — end. Pinned to the shared T2 anchor so the
  // seed, the buildGifi continuity balances, and the whole-dollar rounding plug
  // can NEVER drift (gap-fix blocker 5).
  RETAINED_EARNINGS: GIFI_RETAINED_EARNINGS,
  COMMON_SHARES: '3500', // Common shares / share capital
  TRADE_SALES: '8000', // Trade sales of goods and services
  INTEREST_INCOME: '8090', // Interest income
  OTHER_INCOME: '8210', // Realized gains / other revenue
} as const

type Acct = {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
  accountSubclass: string
  detailType: string
  gifiCode: string | null
}

const n = (s: string) => s.toLowerCase()

/**
 * Decide the conservative GIFI code for one account, or null if we are not
 * confident enough to assign one (the common case — leave it for the accountant).
 */
function proposeGifi(a: Acct): string | null {
  const name = n(a.accountName)
  const sub = n(a.accountSubclass)
  const detail = n(a.detailType)
  const num = parseInt(a.accountNumber, 10)

  switch (a.accountClass) {
    case 'asset': {
      // Cash / bank: detailType "Bank", subclass "Bank", or name mentions
      // cash/chequing/savings/bank. 1000-range is the conventional cash block.
      if (
        detail === 'bank' ||
        sub === 'bank' ||
        /\b(cash|chequing|checking|savings|bank)\b/.test(name)
      ) {
        return GIFI.CASH
      }
      // Accounts receivable (trade). Avoid GST/ITC receivable, which is NOT 1060.
      if (
        (detail.includes('accounts receivable') ||
          sub.includes('accounts receivable') ||
          /accounts? receivable|trade receivable|\ba\/r\b/.test(name)) &&
        !/gst|hst|itc|tax/.test(name)
      ) {
        return GIFI.ACCOUNTS_RECEIVABLE
      }
      return null
    }

    case 'liability': {
      // GST/HST payable — check BEFORE generic A/P so a "GST payable" account
      // doesn't get mislabelled as trade payables.
      if (/\b(gst|hst)\b/.test(name) && /payable|owing|collected|liab/.test(name)) {
        return GIFI.GST_HST_PAYABLE
      }
      // Trade accounts payable / accrued liabilities.
      if (
        detail.includes('accounts payable') ||
        sub.includes('accounts payable') ||
        /accounts? payable|trade payable|\ba\/p\b/.test(name)
      ) {
        return GIFI.ACCOUNTS_PAYABLE
      }
      return null
    }

    case 'equity': {
      if (/retained earnings|deficit/.test(name)) return GIFI.RETAINED_EARNINGS
      if (/common shares?|share capital|capital stock/.test(name)) return GIFI.COMMON_SHARES
      // Don't touch dividends-declared / other equity — those vary.
      return null
    }

    case 'income': {
      // Interest income is its own GIFI line and is easy to detect.
      if (/interest/.test(name)) return GIFI.INTEREST_INCOME
      // Other / miscellaneous income.
      if (detail === 'other income' || /other income|miscellaneous income|gain/.test(name)) {
        return GIFI.OTHER_INCOME
      }
      // Core trade revenue: detailType "Income"/subclass "Income", or names like
      // sales / revenue / fees / service income. Conservative but high-signal.
      if (
        detail === 'income' ||
        sub === 'income' ||
        /\b(sales|revenue|service income|fees? income|professional fees)\b/.test(name) ||
        (!Number.isNaN(num) && num >= 4000 && num < 4900)
      ) {
        return GIFI.TRADE_SALES
      }
      return null
    }

    case 'expense':
      // NEVER guess a specific expense GIFI — they vary too much and a wrong
      // code silently misstates the T2. Left null for the accountant.
      return null

    default:
      return null
  }
}

async function main() {
  const checkOnly = process.argv.includes('--check')
  console.log(`ensure-gifi-codes ${checkOnly ? '(--check, read-only)' : ''}`)
  console.log('  DB:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))

  const accounts = (await prisma.gLAccount.findMany({
    where: { isArchived: false },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    select: {
      id: true,
      accountNumber: true,
      accountName: true,
      accountClass: true,
      accountSubclass: true,
      detailType: true,
      gifiCode: true,
    },
  })) as Acct[]

  let proposed = 0
  let skippedAlreadySet = 0
  let leftBlank = 0
  const changes: Array<{ acct: Acct; code: string }> = []

  for (const a of accounts) {
    if (a.gifiCode && a.gifiCode.trim()) {
      // Manual mapping always wins; never overwrite.
      skippedAlreadySet++
      continue
    }
    const code = proposeGifi(a)
    if (!code) {
      leftBlank++
      continue
    }
    proposed++
    changes.push({ acct: a, code })
  }

  console.log(
    `  ${accounts.length} active accounts: ${skippedAlreadySet} already mapped, ` +
      `${proposed} to set, ${leftBlank} left blank (accountant to complete).`
  )
  for (const { acct, code } of changes) {
    console.log(
      `    ${checkOnly ? 'would set' : 'set'} ${acct.accountNumber.padEnd(8)} ` +
        `${acct.accountName.padEnd(36)} -> GIFI ${code}`
    )
  }

  if (checkOnly) {
    console.log('  (check) no changes written.')
  } else {
    for (const { acct, code } of changes) {
      await prisma.gLAccount.update({ where: { id: acct.id }, data: { gifiCode: code } })
    }
    console.log(`  ✓ Applied ${changes.length} GIFI default(s).`)
  }

  console.log(
    '  NOTE: This only covers unambiguous accounts. The accountant must confirm ' +
      'these and complete the remaining (especially every expense) GIFI codes ' +
      'from the prior-year T2 before filing.'
  )
}

main()
  .catch((e) => {
    console.error('ensure-gifi-codes FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
