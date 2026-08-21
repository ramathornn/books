import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Wiping all tenant data (preserving users and company settings)...')

  // Order matters due to FK constraints — children first, parents last.

  // Accounting
  const journalLines = await prisma.journalEntryLine.deleteMany({})
  console.log(`  Journal entry lines: ${journalLines.count}`)
  const journalEntries = await prisma.journalEntry.deleteMany({})
  console.log(`  Journal entries: ${journalEntries.count}`)
  const bankTxns = await prisma.bankTransaction.deleteMany({})
  console.log(`  Bank transactions: ${bankTxns.count}`)
  const bankAccounts = await prisma.bankAccount.deleteMany({})
  console.log(`  Bank accounts: ${bankAccounts.count}`)

  // Time tracking
  const timeEntries = await prisma.timeEntry.deleteMany({})
  console.log(`  Time entries: ${timeEntries.count}`)
  const services = await prisma.service.deleteMany({})
  console.log(`  Services: ${services.count}`)

  // Expenses
  const expenses = await prisma.expense.deleteMany({})
  console.log(`  Expenses: ${expenses.count}`)
  const vendors = await prisma.vendor.deleteMany({})
  console.log(`  Vendors: ${vendors.count}`)
  // Break parent/child ExpenseCategory refs before deleting
  await prisma.expenseCategory.updateMany({ data: { parentId: null } })
  const expenseCategories = await prisma.expenseCategory.deleteMany({})
  console.log(`  Expense categories: ${expenseCategories.count}`)

  // Projects (referenced by time entries / expenses — safe to drop now)
  const projects = await prisma.project.deleteMany({})
  console.log(`  Projects: ${projects.count}`)

  // Team members
  const teamMembers = await prisma.teamMember.deleteMany({})
  console.log(`  Team members: ${teamMembers.count}`)

  // Invoices / estimates / payments
  const payments = await prisma.payment.deleteMany({})
  console.log(`  Payments: ${payments.count}`)
  const invoiceLineItems = await prisma.invoiceLineItem.deleteMany({})
  console.log(`  Invoice line items: ${invoiceLineItems.count}`)
  const invoiceActivities = await prisma.invoiceActivity.deleteMany({})
  console.log(`  Invoice activities: ${invoiceActivities.count}`)
  const invoices = await prisma.invoice.deleteMany({})
  console.log(`  Invoices: ${invoices.count}`)
  const estimateResponses = await prisma.estimateResponse.deleteMany({})
  console.log(`  Estimate responses: ${estimateResponses.count}`)
  const estimateLineItems = await prisma.estimateLineItem.deleteMany({})
  console.log(`  Estimate line items: ${estimateLineItems.count}`)
  const estimates = await prisma.estimate.deleteMany({})
  console.log(`  Estimates: ${estimates.count}`)

  const items = await prisma.item.deleteMany({})
  console.log(`  Items: ${items.count}`)

  const clients = await prisma.client.deleteMany({})
  console.log(`  Clients: ${clients.count}`)

  // Chart of accounts — break parent refs first
  await prisma.gLAccount.updateMany({ data: { parentId: null } })
  const glAccounts = await prisma.gLAccount.deleteMany({})
  console.log(`  GL accounts: ${glAccounts.count}`)

  const favoriteReports = await prisma.favoriteReport.deleteMany({})
  console.log(`  Favorite reports: ${favoriteReports.count}`)

  console.log('Wipe complete. Users and company settings preserved.')

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('Wipe failed:', e)
  process.exit(1)
})
