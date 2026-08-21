import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

// Path resolution: works locally (data/ next to app/) and on prod (/var/www/accounting/data/)
const DATA_PATHS = [
  path.resolve(__dirname, '..', 'data'),
  path.resolve(__dirname, '..', '..', 'data'),
]

function findDataFile(name: string): string {
  for (const dir of DATA_PATHS) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) return p
  }
  throw new Error(`Could not find ${name} in: ${DATA_PATHS.join(', ')}`)
}

interface CoaAccount {
  number: string
  name: string
  type: string
  currency: string
  taxLabel: string
}

function parseCOA(): CoaAccount[] {
  const raw = JSON.parse(fs.readFileSync(findDataFile('coa.json'), 'utf8')) as string[][]
  // First row is header
  return raw.slice(1).map((r) => ({
    number: r[0] || '',
    name: r[1] || '',
    type: r[2] || '',
    currency: r[3] || 'CAD',
    taxLabel: r[4] || '',
  }))
}

// Map exported account type to our (accountClass, subclass)
function mapType(exportType: string): { accountClass: string; accountSubclass: string } {
  const t = exportType.trim()
  switch (t) {
    case 'Bank':
      return { accountClass: 'asset', accountSubclass: 'Bank' }
    case 'Accounts receivable (A/R)':
      return { accountClass: 'asset', accountSubclass: 'Accounts Receivable' }
    case 'Current assets':
      return { accountClass: 'asset', accountSubclass: 'Current Assets' }
    case 'Property, plant and equipment':
      return { accountClass: 'asset', accountSubclass: 'Property, Plant and Equipment' }
    case 'Credit Card':
      return { accountClass: 'liability', accountSubclass: 'Credit Card' }
    case 'Accounts payable (A/P)':
      return { accountClass: 'liability', accountSubclass: 'Accounts Payable' }
    case 'Other Current Liabilities':
      return { accountClass: 'liability', accountSubclass: 'Other Current Liabilities' }
    case 'Long-term Liabilities':
      return { accountClass: 'liability', accountSubclass: 'Long-term Liabilities' }
    case 'Equity':
      return { accountClass: 'equity', accountSubclass: 'Equity' }
    case 'Income':
      return { accountClass: 'income', accountSubclass: 'Income' }
    case 'Other Income':
      return { accountClass: 'income', accountSubclass: 'Other Income' }
    case 'Cost of Goods Sold':
      return { accountClass: 'expense', accountSubclass: 'Cost of Goods Sold' }
    case 'Expenses':
      return { accountClass: 'expense', accountSubclass: 'Operating Expenses' }
    case 'Other Expense':
      return { accountClass: 'expense', accountSubclass: 'Other Expense' }
    default:
      console.warn(`  ⚠ Unmapped account type: "${t}" — defaulting to expense`)
      return { accountClass: 'expense', accountSubclass: t }
  }
}

function isReconcilable(exportType: string): boolean {
  const t = exportType.trim()
  return t === 'Bank' || t === 'Credit Card'
}

// Generate a stable synthetic account number for accounts with no number,
// so the unique constraint holds. Format: SYS-<slug>
function syntheticNumber(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
  return `SYS-${slug}`
}

interface SeedTaxCode {
  code: string
  name: string
  description: string
  rate: number // percent (5 = 5%)
  appliesTo: 'sale' | 'purchase' | 'both'
  isReportable: boolean
  isRecoverable: boolean
  deductiblePct: number
  payableAccountNumber?: string // resolved later
  receivableAccountNumber?: string
}

const TAX_CODES: SeedTaxCode[] = [
  {
    code: 'GST_INCOME',
    name: 'GST on Income',
    description: 'GST 5% collected on Canadian sales',
    rate: 5,
    appliesTo: 'sale',
    isReportable: true,
    isRecoverable: true,
    deductiblePct: 100,
    payableAccountNumber: '2315',
  },
  {
    code: 'GST_EXPENSE',
    name: 'GST on Expenses',
    description: 'GST 5% paid on purchases (full ITC)',
    rate: 5,
    appliesTo: 'purchase',
    isReportable: true,
    isRecoverable: true,
    deductiblePct: 100,
    receivableAccountNumber: '2315',
  },
  {
    code: 'ZERO_RATED',
    name: 'Zero-Rated',
    description: 'GST/HST 0% — exports, basic groceries, prescription drugs',
    rate: 0,
    appliesTo: 'both',
    isReportable: true,
    isRecoverable: true,
    deductiblePct: 100,
  },
  {
    code: 'OUT_OF_SCOPE',
    name: 'Out of Scope',
    description: 'Not subject to GST/HST — bank fees, salaries, owner draws',
    rate: 0,
    appliesTo: 'both',
    isReportable: false,
    isRecoverable: false,
    deductiblePct: 100,
  },
  {
    code: 'EXEMPT',
    name: 'Exempt',
    description: 'GST/HST exempt — most financial services, residential rent, health care',
    rate: 0,
    appliesTo: 'both',
    isReportable: true,
    isRecoverable: false,
    deductiblePct: 100,
  },
  {
    code: 'MEALS_50',
    name: 'Meals (50% deductible)',
    description: 'Meals & entertainment with 50% income-tax deductibility cap',
    rate: 5,
    appliesTo: 'purchase',
    isReportable: true,
    isRecoverable: true,
    deductiblePct: 50,
    receivableAccountNumber: '2315',
  },
]

interface BankAccountSeed {
  glNumber: string
  bankName: string
  masked: string
  accountType: 'checking' | 'savings' | 'credit_card' | 'cash' | 'wallet'
  sortOrder: number
}

// Placeholder bank accounts — edit to match your chart of accounts
const BANK_ACCOUNT_DEFAULTS: BankAccountSeed[] = [
  { glNumber: '1130', bankName: 'Bank', masked: '0001', accountType: 'checking', sortOrder: 1 },
  { glNumber: '1135', bankName: 'Bank', masked: '0002', accountType: 'savings', sortOrder: 2 },
  { glNumber: '1138', bankName: 'RBC', masked: '2567', accountType: 'savings', sortOrder: 3 },
  { glNumber: '1140B', bankName: 'Wise', masked: '', accountType: 'wallet', sortOrder: 4 },
  { glNumber: '1141', bankName: 'Wise', masked: '', accountType: 'wallet', sortOrder: 5 },
  { glNumber: '1142', bankName: 'Wise', masked: '', accountType: 'wallet', sortOrder: 6 },
  { glNumber: '1145', bankName: 'Cash', masked: '', accountType: 'cash', sortOrder: 7 },
  { glNumber: '2087', bankName: 'RBC', masked: '1978', accountType: 'credit_card', sortOrder: 8 },
]

async function seedCOA() {
  console.log('\n== Chart of Accounts ==')
  const accounts = parseCOA()
  console.log(`  Read ${accounts.length} accounts from coa.json`)

  let inserted = 0
  let updated = 0
  let order = 0
  for (const a of accounts) {
    if (!a.name) continue
    const number = a.number || syntheticNumber(a.name)
    const { accountClass, accountSubclass } = mapType(a.type)
    order += 1

    const existing = await prisma.gLAccount.findUnique({ where: { accountNumber: number } })
    const data = {
      accountNumber: number,
      accountName: a.name,
      accountClass,
      accountSubclass,
      detailType: a.type,
      currency: a.currency || 'CAD',
      isReconcilable: isReconcilable(a.type),
      sortOrder: order,
    }
    if (existing) {
      await prisma.gLAccount.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      await prisma.gLAccount.create({ data })
      inserted += 1
    }
  }
  console.log(`  ✓ ${inserted} inserted, ${updated} updated`)
}

async function seedTaxCodes() {
  console.log('\n== Tax Codes ==')
  let inserted = 0
  let updated = 0
  for (const tc of TAX_CODES) {
    const payable = tc.payableAccountNumber
      ? await prisma.gLAccount.findUnique({ where: { accountNumber: tc.payableAccountNumber } })
      : null
    const receivable = tc.receivableAccountNumber
      ? await prisma.gLAccount.findUnique({ where: { accountNumber: tc.receivableAccountNumber } })
      : null

    const data = {
      code: tc.code,
      name: tc.name,
      description: tc.description,
      rate: tc.rate / 100, // convert percent to decimal
      appliesTo: tc.appliesTo,
      isReportable: tc.isReportable,
      isRecoverable: tc.isRecoverable,
      deductiblePct: tc.deductiblePct,
      payableAccountId: payable?.id ?? null,
      receivableAccountId: receivable?.id ?? null,
    }
    const existing = await prisma.taxCode.findUnique({ where: { code: tc.code } })
    if (existing) {
      await prisma.taxCode.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      await prisma.taxCode.create({ data })
      inserted += 1
    }
  }
  console.log(`  ✓ ${inserted} inserted, ${updated} updated`)
}

async function seedBankAccounts() {
  console.log('\n== Bank Accounts ==')
  let inserted = 0
  let updated = 0
  for (const b of BANK_ACCOUNT_DEFAULTS) {
    const gl = await prisma.gLAccount.findUnique({ where: { accountNumber: b.glNumber } })
    if (!gl) {
      console.warn(`  ⚠ GL account ${b.glNumber} not found, skipping bank account`)
      continue
    }
    const data = {
      glAccountId: gl.id,
      bankName: b.bankName,
      accountNumberMasked: b.masked,
      accountType: b.accountType,
      sortOrder: b.sortOrder,
    }
    const existing = await prisma.bankAccount.findUnique({ where: { glAccountId: gl.id } })
    if (existing) {
      await prisma.bankAccount.update({ where: { id: existing.id }, data })
      updated += 1
    } else {
      await prisma.bankAccount.create({ data })
      inserted += 1
    }
  }
  console.log(`  ✓ ${inserted} inserted, ${updated} updated`)
}

async function main() {
  console.log('Seeding accounting reference data')
  console.log('  DB:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':***@'))
  await seedCOA()
  await seedTaxCodes()
  await seedBankAccounts()
  console.log('\nDone.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
