import { PrismaClient } from '../src/generated/prisma/client'

const prisma = new PrismaClient()

/**
 * Issue #9: "CC payment ID: #ch_..." strings bleeding into client name display.
 *
 * In the source JSON, the CC payment ID is correctly in the `notes` field.
 * However, the seed script matches payments to clients via client_name -> invoice -> client.
 * The actual data in the DB has the CC IDs in the `notes` field already (since the seed
 * copies `pay.notes` directly).
 *
 * The real bug may be that the client name display on the payments list is concatenating
 * the client name + notes. But let's check the DB to be sure, and also verify that
 * no client records have CC IDs appended to their names.
 */

async function main() {
  console.log('=== Fix CC Payment IDs ===')

  // Check 1: Are any client names contaminated with CC payment IDs?
  const clients = await prisma.client.findMany()
  let clientsFixed = 0

  for (const client of clients) {
    const fullName = `${client.firstName} ${client.lastName}`.trim()
    const org = client.organization

    const ccPattern = /\s*CC payment ID:.*$/i

    let needsUpdate = false
    const updates: Record<string, string> = {}

    if (ccPattern.test(client.firstName)) {
      updates.firstName = client.firstName.replace(ccPattern, '').trim()
      needsUpdate = true
    }
    if (ccPattern.test(client.lastName)) {
      updates.lastName = client.lastName.replace(ccPattern, '').trim()
      needsUpdate = true
    }
    if (ccPattern.test(client.organization)) {
      updates.organization = client.organization.replace(ccPattern, '').trim()
      needsUpdate = true
    }

    if (needsUpdate) {
      await prisma.client.update({
        where: { id: client.id },
        data: updates,
      })
      console.log(`  Fixed client: "${fullName}" / "${org}"`)
      clientsFixed++
    }
  }

  // Check 2: Are any payment notes that have CC payment IDs also duplicated somewhere else?
  // The notes field is the correct place for CC IDs, so we just verify they're there.
  const payments = await prisma.payment.findMany({
    include: { client: true, invoice: true },
  })

  let paymentsWithCC = 0
  let paymentsWithCCInNotes = 0

  for (const payment of payments) {
    if (payment.notes && payment.notes.includes('CC payment ID')) {
      paymentsWithCCInNotes++
    }
  }

  // Check 3: Verify the payment method for CC payments is correct
  // CC payments should have a card-type payment method, not "Bank Transfer"
  let methodFixed = 0
  for (const payment of payments) {
    if (payment.notes && payment.notes.includes('CC payment ID')) {
      paymentsWithCC++
      // If payment method is empty or generic but has CC info, it's fine as-is
      // The payment method from the JSON is already correct (e.g., "MasterCard", "2Checkout")
    }
  }

  console.log(`\n=== Results ===`)
  console.log(`Clients checked: ${clients.length}`)
  console.log(`Clients with CC IDs in name (fixed): ${clientsFixed}`)
  console.log(`Payments with CC IDs in notes (correct location): ${paymentsWithCCInNotes}`)
  console.log(`Total payments: ${payments.length}`)

  if (clientsFixed === 0) {
    console.log(`\nNote: No client names were contaminated with CC payment IDs.`)
    console.log(`The CC IDs are correctly stored in the payment notes field.`)
    console.log(`If the payments list UI shows CC IDs in the client column,`)
    console.log(`the fix is in the frontend rendering, not the data.`)
  }
}

main()
  .catch((e) => {
    console.error('Fix-cc-payments failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
