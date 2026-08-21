import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

async function main() {
  const [clients, invoices, invoiceLineItems, estimates, estimateLineItems, payments, items, users] = await Promise.all([
    prisma.client.count(),
    prisma.invoice.count(),
    prisma.invoiceLineItem.count(),
    prisma.estimate.count(),
    prisma.estimateLineItem.count(),
    prisma.payment.count(),
    prisma.item.count(),
    prisma.user.count(),
  ])

  console.log('Current DB state:')
  console.log(`  Users: ${users}`)
  console.log(`  Clients: ${clients}`)
  console.log(`  Invoices: ${invoices}`)
  console.log(`  Invoice line items: ${invoiceLineItems}`)
  console.log(`  Estimates: ${estimates}`)
  console.log(`  Estimate line items: ${estimateLineItems}`)
  console.log(`  Payments: ${payments}`)
  console.log(`  Items: ${items}`)

  await prisma.$disconnect()
}

main()
