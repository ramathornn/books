import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

/**
 * Idempotently ensure the realized Foreign Exchange Gain/Loss account exists.
 *
 * Locked decision (Wave 1 spec): realized FX → account number 499 everywhere,
 * income/credit-normal (gains CREDIT, losses DEBIT), no 6651 fallback.
 *
 * Behaviour:
 *   - If 499 already exists: assert accountClass === 'income'. If it is some
 *     other class, ABORT LOUDLY (do not mutate it) — a human must reconcile.
 *   - If 499 is absent: create it (class income, subclass/detailType
 *     'Other Income', name 'Realized Currency Gains').
 *   - `--check` validates only; it never creates.
 *
 * This script only touches GLAccount number 499. It does not run migrations.
 */

const ACCOUNT_NUMBER = '499'
const ACCOUNT_NAME = 'Realized Currency Gains'
const ACCOUNT_CLASS = 'income'
const ACCOUNT_SUBCLASS = 'Other Income'
const DETAIL_TYPE = 'Other Income'

async function main() {
  const checkOnly = process.argv.includes('--check')
  console.log(`ensure-fx-accounts ${checkOnly ? '(--check, read-only)' : ''}`)
  console.log('  DB:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))

  const existing = await prisma.gLAccount.findFirst({ where: { accountNumber: ACCOUNT_NUMBER } })

  if (existing) {
    if (existing.accountClass !== ACCOUNT_CLASS) {
      throw new Error(
        `Account ${ACCOUNT_NUMBER} ("${existing.accountName}") exists but is class ` +
          `'${existing.accountClass}', expected '${ACCOUNT_CLASS}'. ` +
          `Refusing to mutate — resolve this manually before FX posting goes live.`
      )
    }
    console.log(
      `  ✓ Account ${ACCOUNT_NUMBER} present and valid: "${existing.accountName}" (${existing.accountClass})`
    )
    return
  }

  if (checkOnly) {
    throw new Error(
      `Account ${ACCOUNT_NUMBER} is MISSING. Run ensure-fx-accounts without --check to create it.`
    )
  }

  const created = await prisma.gLAccount.create({
    data: {
      accountNumber: ACCOUNT_NUMBER,
      accountName: ACCOUNT_NAME,
      accountClass: ACCOUNT_CLASS,
      accountSubclass: ACCOUNT_SUBCLASS,
      detailType: DETAIL_TYPE,
      currency: 'CAD',
      isActive: true,
    },
  })
  console.log(`  ✓ Created account ${created.accountNumber} "${created.accountName}" (${created.accountClass})`)
}

main()
  .catch((e) => {
    console.error('ensure-fx-accounts FAILED:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
