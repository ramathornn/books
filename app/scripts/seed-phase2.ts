import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

// Default chart of accounts (standard small-business skeleton)
const GL_ACCOUNTS: Array<{
  number: string
  name: string
  class: 'asset' | 'liability' | 'equity' | 'income' | 'expense'
  subclass: string
  reconcilable?: boolean
}> = [
  // Assets
  { number: '1000', name: 'Cash', class: 'asset', subclass: 'Cash & Bank', reconcilable: true },
  { number: '1000-1', name: 'Petty Cash', class: 'asset', subclass: 'Cash & Bank' },
  { number: '1200-1', name: 'Accounts Receivable', class: 'asset', subclass: 'Current Asset' },
  { number: '1200-2', name: 'Customer Deposits', class: 'asset', subclass: 'Current Asset' },
  { number: '1201', name: 'Deposits', class: 'asset', subclass: 'Current Asset' },
  { number: '1202', name: 'Prepaid Expenses', class: 'asset', subclass: 'Current Asset' },
  { number: '1600-1', name: 'Deferred Discounts', class: 'asset', subclass: 'Current Asset' },
  // Liabilities
  { number: '2000', name: 'Accounts Payable', class: 'liability', subclass: 'Current Liability' },
  { number: '2100', name: 'Sales Tax Payable', class: 'liability', subclass: 'Current Liability' },
  { number: '2200', name: 'Credit Card Payable', class: 'liability', subclass: 'Current Liability' },
  // Equity
  { number: '3000', name: "Owner's Equity", class: 'equity', subclass: 'Equity' },
  { number: '3100', name: 'Retained Earnings', class: 'equity', subclass: 'Equity' },
  // Income
  { number: '4000', name: 'Sales Revenue', class: 'income', subclass: 'Income' },
  { number: '4100', name: 'Service Revenue', class: 'income', subclass: 'Income' },
  { number: '4200', name: 'Other Income', class: 'income', subclass: 'Income' },
  // COGS / Expenses
  { number: '5000', name: 'Cost of Goods Sold', class: 'expense', subclass: 'COGS' },
  { number: '6000', name: 'Advertising', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6010', name: 'Bank Fees', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6020', name: 'Meals & Entertainment', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6030', name: 'Travel', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6040', name: 'Office Supplies', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6050', name: 'Software', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6060', name: 'Utilities', class: 'expense', subclass: 'Operating Expenses' },
  { number: '6070', name: 'Rent - Office Space', class: 'expense', subclass: 'Rent or Lease' },
  { number: '6080', name: 'Accounting', class: 'expense', subclass: 'Professional Services' },
  { number: '6090', name: 'Legal Fees', class: 'expense', subclass: 'Professional Services' },
]

const EXPENSE_CATEGORIES: Array<{ group: string; name: string; gl?: string }> = [
  // Operating
  { group: 'Operating Expenses', name: 'Advertising', gl: '6000' },
  { group: 'Operating Expenses', name: 'Bank Fees', gl: '6010' },
  { group: 'Operating Expenses', name: 'Meals & Entertainment', gl: '6020' },
  { group: 'Operating Expenses', name: 'Travel', gl: '6030' },
  { group: 'Operating Expenses', name: 'Office Equipment' },
  { group: 'Operating Expenses', name: 'Equipment Rental' },
  { group: 'Operating Expenses', name: 'Utilities', gl: '6060' },
  { group: 'Operating Expenses', name: 'Cleaning' },
  { group: 'Operating Expenses', name: 'Groceries/Food' },
  { group: 'Operating Expenses', name: 'Hardware' },
  { group: 'Operating Expenses', name: 'Office Supplies', gl: '6040' },
  { group: 'Operating Expenses', name: 'Packaging' },
  { group: 'Operating Expenses', name: 'Postage' },
  { group: 'Operating Expenses', name: 'Printing' },
  { group: 'Operating Expenses', name: 'Shipping & Couriers' },
  { group: 'Operating Expenses', name: 'Software', gl: '6050' },
  { group: 'Operating Expenses', name: 'Car & Truck Expenses' },
  // Capital
  { group: 'Capital Expenses', name: 'Commissions' },
  { group: 'Capital Expenses', name: 'Depreciation' },
  { group: 'Capital Expenses', name: 'Interest - Mortgage' },
  { group: 'Capital Expenses', name: 'Interest - Other' },
  { group: 'Capital Expenses', name: 'Online Services' },
  { group: 'Capital Expenses', name: 'Reference Materials' },
  { group: 'Capital Expenses', name: 'Repairs & Maintenance' },
  // Pro Services
  { group: 'Professional Services', name: 'Accounting', gl: '6080' },
  { group: 'Professional Services', name: 'Legal Fees', gl: '6090' },
  // Rent
  { group: 'Rent or Lease', name: 'Office Space', gl: '6070' },
  { group: 'Rent or Lease', name: 'Equipment' },
  { group: 'Rent or Lease', name: 'Machinery' },
]

const SERVICES = [
  { name: 'Development', rate: 120 },
  { name: 'Design', rate: 95 },
  { name: 'Consultation', rate: 150 },
  { name: 'Project Management', rate: 110 },
  { name: 'Support', rate: 75 },
]

async function main() {
  console.log('Seeding Phase 2 reference data...')

  // GL accounts
  for (const gl of GL_ACCOUNTS) {
    await prisma.gLAccount.upsert({
      where: { accountNumber: gl.number },
      create: {
        accountNumber: gl.number,
        accountName: gl.name,
        accountClass: gl.class,
        accountSubclass: gl.subclass,
        isReconcilable: gl.reconcilable ?? false,
        currency: 'CAD',
      },
      update: {},
    })
  }
  console.log(`  GL accounts: ${GL_ACCOUNTS.length} upserted`)

  // Link parent for Petty Cash (under Cash)
  const cash = await prisma.gLAccount.findUnique({ where: { accountNumber: '1000' } })
  if (cash) {
    await prisma.gLAccount.updateMany({
      where: { accountNumber: '1000-1' },
      data: { parentId: cash.id },
    })
  }
  const ar = await prisma.gLAccount.findUnique({ where: { accountNumber: '1200-1' } })
  if (ar) {
    await prisma.gLAccount.updateMany({
      where: { accountNumber: { in: ['1200-2', '1600-1'] } },
      data: { parentId: ar.id },
    })
  }

  // Expense categories
  for (const ec of EXPENSE_CATEGORIES) {
    const gl = ec.gl
      ? await prisma.gLAccount.findUnique({ where: { accountNumber: ec.gl } })
      : null
    await prisma.expenseCategory.upsert({
      where: { name_groupName: { name: ec.name, groupName: ec.group } },
      create: {
        name: ec.name,
        groupName: ec.group,
        glAccountId: gl?.id,
      },
      update: { glAccountId: gl?.id },
    })
  }
  console.log(`  Expense categories: ${EXPENSE_CATEGORIES.length} upserted`)

  // Car & Truck sub-categories
  const car = await prisma.expenseCategory.findFirst({
    where: { name: 'Car & Truck Expenses' },
  })
  if (car) {
    for (const sub of ['Gas', 'Mileage', 'Repairs', 'Vehicle Insurance', 'Vehicle Licensing']) {
      await prisma.expenseCategory.upsert({
        where: { name_groupName: { name: sub, groupName: 'Operating Expenses' } },
        create: { name: sub, groupName: 'Operating Expenses', parentId: car.id },
        update: { parentId: car.id },
      })
    }
  }

  // Services
  for (const s of SERVICES) {
    await prisma.service.upsert({
      where: { name: s.name },
      create: { name: s.name, hourlyRate: s.rate },
      update: {},
    })
  }
  console.log(`  Services: ${SERVICES.length} upserted`)

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
