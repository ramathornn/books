import { PrismaClient } from '../src/generated/prisma/client'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

// Try multiple data directory locations
const possibleDataDirs = [
  path.resolve(__dirname, '../data'),      // ../data from scripts/ (server layout)
  path.resolve(__dirname, '../../data'),   // ../../data from scripts/ (monorepo layout)
]
const DATA_DIR = possibleDataDirs.find(d => fs.existsSync(d)) || possibleDataDirs[0]

interface RawClient {
  id: string
  fb_id: string
  fname: string
  lname: string
  organization: string
  email: string
  phonenumber: string
  address: string
  currency: string
  linked_fb_invoice_ids: string[]
}

interface RawInvoice {
  fb_id: string
  invoice_number: string
  status: string
  currency: string
  date_issued: string
  date_due: string
  billed_to: string
  subtotal: string
  tax_totals: { name: string; amount: string }[]
  total: string
  amount_due: string
  amount_paid: string
  line_items: any[]
}

interface RawPayment {
  client_name: string
  invoice_number: string
  payment_date: string
  payment_method: string
  notes: string
  amount: string
  currency: string
  status: string
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

async function main() {
  console.log('=== Fix Client-Invoice/Payment Linking ===')

  // Load source data
  const rawClients: RawClient[] = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'clients.json'), 'utf-8')
  )
  const rawInvoices: RawInvoice[] = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'invoices.json'), 'utf-8')
  )
  const rawPayments: RawPayment[] = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'payments.json'), 'utf-8')
  )

  // Load all DB clients
  const dbClients = await prisma.client.findMany()
  console.log(`DB Clients: ${dbClients.length}`)

  // Build comprehensive lookup maps for client matching
  // Strategy: Use the linked_fb_invoice_ids from clients.json to build
  // a definitive fb_id -> client mapping, then match invoices by fb_id.

  // Map: invoice fb_id -> client db id (from clients.json linked_fb_invoice_ids)
  const invoiceFbIdToClientDbId = new Map<string, string>()

  // Map: raw client fb_id -> db client id
  const clientFbIdToDbId = new Map<string, string>()
  for (const dbClient of dbClients) {
    if (dbClient.fbId) {
      clientFbIdToDbId.set(dbClient.fbId, dbClient.id)
    }
  }

  // Build invoice -> client mapping from clients.json linked_fb_invoice_ids
  for (const rawClient of rawClients) {
    const dbClientId = clientFbIdToDbId.get(rawClient.fb_id)
    if (!dbClientId) continue

    for (const invFbId of rawClient.linked_fb_invoice_ids) {
      invoiceFbIdToClientDbId.set(invFbId, dbClientId)
    }
  }
  console.log(`Invoice->Client links from clients.json: ${invoiceFbIdToClientDbId.size}`)

  // Also build name-based lookup maps for fallback matching
  const nameToClientId = new Map<string, string>()
  const normalizedNameToClientId = new Map<string, string>()

  for (const dbClient of dbClients) {
    const fullName = `${dbClient.firstName} ${dbClient.lastName}`.trim()
    if (fullName) {
      nameToClientId.set(fullName, dbClient.id)
      normalizedNameToClientId.set(normalize(fullName), dbClient.id)
    }
    if (dbClient.firstName) {
      // Don't overwrite full name matches with first-name-only
      if (!nameToClientId.has(dbClient.firstName)) {
        nameToClientId.set(dbClient.firstName, dbClient.id)
      }
    }
    if (dbClient.organization) {
      nameToClientId.set(dbClient.organization, dbClient.id)
      normalizedNameToClientId.set(normalize(dbClient.organization), dbClient.id)
    }
  }

  // --- Fix Invoices ---
  console.log('\n--- Fixing Invoice Client Links ---')
  const dbInvoices = await prisma.invoice.findMany()
  let invoicesFixed = 0
  let invoicesAlreadyCorrect = 0
  let invoicesUnmatched = 0

  for (const dbInvoice of dbInvoices) {
    // Strategy 1: Use fb_id -> client mapping from clients.json linked IDs
    let correctClientId = dbInvoice.fbId ? invoiceFbIdToClientDbId.get(dbInvoice.fbId) : undefined

    // Strategy 2: Look up billed_to from raw invoice data
    if (!correctClientId) {
      const rawInv = rawInvoices.find(r => r.fb_id === dbInvoice.fbId)
      if (rawInv) {
        const billedTo = rawInv.billed_to

        // Exact name match
        correctClientId = nameToClientId.get(billedTo)

        // Normalized match
        if (!correctClientId) {
          correctClientId = normalizedNameToClientId.get(normalize(billedTo))
        }

        // Partial match: billed_to contains or is contained by a client name
        if (!correctClientId) {
          const normalizedBilled = normalize(billedTo)
          for (const [normName, clientId] of normalizedNameToClientId.entries()) {
            if (normalizedBilled.includes(normName) || normName.includes(normalizedBilled)) {
              correctClientId = clientId
              break
            }
          }
        }

        if (!correctClientId) {
          console.log(`  UNMATCHED invoice ${dbInvoice.invoiceNumber}: billed_to="${billedTo}" (fb_id: ${dbInvoice.fbId})`)
          invoicesUnmatched++
          continue
        }
      } else {
        // No raw data for this invoice - skip
        continue
      }
    }

    if (dbInvoice.clientId === correctClientId) {
      invoicesAlreadyCorrect++
      continue
    }

    await prisma.invoice.update({
      where: { id: dbInvoice.id },
      data: { clientId: correctClientId },
    })

    const rawInv = rawInvoices.find(r => r.fb_id === dbInvoice.fbId)
    const client = dbClients.find(c => c.id === correctClientId)
    console.log(`  Fixed invoice ${dbInvoice.invoiceNumber}: "${rawInv?.billed_to}" -> client "${client?.firstName} ${client?.lastName}" (${client?.organization})`)
    invoicesFixed++
  }

  // --- Fix Payments ---
  console.log('\n--- Fixing Payment Client Links ---')
  const dbPayments = await prisma.payment.findMany({
    include: { invoice: true },
  })
  let paymentsFixed = 0
  let paymentsAlreadyCorrect = 0
  let paymentsUnmatched = 0

  // Build invoice_number -> correct clientId from our fixed invoices
  const fixedInvoices = await prisma.invoice.findMany({
    select: { id: true, invoiceNumber: true, clientId: true },
  })
  const invoiceNumberToClientId = new Map<string, string>()
  const invoiceNumberToInvoiceId = new Map<string, string>()
  for (const inv of fixedInvoices) {
    invoiceNumberToClientId.set(inv.invoiceNumber, inv.clientId)
    invoiceNumberToInvoiceId.set(inv.invoiceNumber, inv.id)
  }

  for (const dbPayment of dbPayments) {
    // Get the correct client from the invoice
    const correctClientId = dbPayment.invoice
      ? invoiceNumberToClientId.get(dbPayment.invoice.invoiceNumber)
      : undefined

    if (!correctClientId) {
      // Try matching from raw payment data
      const rawPay = rawPayments.find(
        r => r.invoice_number === dbPayment.invoice?.invoiceNumber
      )
      if (rawPay) {
        let clientId = nameToClientId.get(rawPay.client_name)
        if (!clientId) {
          clientId = normalizedNameToClientId.get(normalize(rawPay.client_name))
        }
        if (clientId && dbPayment.clientId !== clientId) {
          await prisma.payment.update({
            where: { id: dbPayment.id },
            data: { clientId },
          })
          paymentsFixed++
          continue
        }
      }
      paymentsUnmatched++
      continue
    }

    if (dbPayment.clientId === correctClientId) {
      paymentsAlreadyCorrect++
      continue
    }

    await prisma.payment.update({
      where: { id: dbPayment.id },
      data: { clientId: correctClientId },
    })
    paymentsFixed++
  }

  console.log(`\n=== Results ===`)
  console.log(`Invoices: ${invoicesFixed} fixed, ${invoicesAlreadyCorrect} already correct, ${invoicesUnmatched} unmatched`)
  console.log(`Payments: ${paymentsFixed} fixed, ${paymentsAlreadyCorrect} already correct, ${paymentsUnmatched} unmatched`)

  // Verify: count invoices per client
  const clientInvoiceCounts = await prisma.invoice.groupBy({
    by: ['clientId'],
    _count: { id: true },
  })
  console.log(`\nClients with invoices: ${clientInvoiceCounts.length}`)

  // Show auto-created clients that may be orphaned
  const autoClients = dbClients.filter(c => !c.fbId)
  if (autoClients.length > 0) {
    console.log(`\nAuto-created clients (no fbId):`)
    for (const ac of autoClients) {
      const invCount = await prisma.invoice.count({ where: { clientId: ac.id } })
      const payCount = await prisma.payment.count({ where: { clientId: ac.id } })
      console.log(`  "${ac.firstName} ${ac.lastName}" (org: "${ac.organization}"): ${invCount} invoices, ${payCount} payments`)
    }
  }
}

main()
  .catch((e) => {
    console.error('Fix-client-links failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
