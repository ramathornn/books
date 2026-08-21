import 'dotenv/config'
import { PrismaClient } from '../src/generated/prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// Try multiple data directory locations
const possibleDataDirs = [
  path.resolve(__dirname, '../data'),      // ../data from scripts/ (server layout)
  path.resolve(__dirname, '../../data'),   // ../../data from scripts/ (monorepo layout)
]
const DATA_DIR = possibleDataDirs.find(d => fs.existsSync(d)) || possibleDataDirs[0]

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

function parseAmount(str: string): number {
  if (!str || str.trim() === '') return 0
  const cleaned = str.trim()
  const isNegative = cleaned.startsWith('-') || cleaned.startsWith('\u2212')
  const numStr = cleaned
    .replace(/[\u2212\-]/g, '')
    .replace(/[$\u20AC\u00A3\u00A5]/g, '')
    .replace(/,/g, '')
    .replace(/\s*(CAD|USD|EUR|GBP)\s*/gi, '')
    .trim()
  const num = parseFloat(numStr)
  if (isNaN(num)) return 0
  return isNegative ? -num : num
}

function parseDateString(dateStr: string): Date {
  if (!dateStr || dateStr.trim() === '') return new Date()
  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return new Date(dateStr)
  const month = parseInt(parts[0], 10)
  const day = parseInt(parts[1], 10)
  const year = parseInt(parts[2], 10)
  return new Date(Date.UTC(year, month - 1, day))
}

function generateShareToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Strip "+GST" suffix from line item descriptions.
 * Tax info belongs in the taxCodes array, not the description text.
 */
function cleanLineItemDescription(desc: string): string {
  return desc.replace(/\s*\+GST\s*/gi, '').trim()
}

/**
 * Clean client name: strip Stripe customer IDs (cus_XXXX pattern).
 * Returns { cleanName, stripeId } so we can store the ID in internalNote.
 */
function cleanClientName(name: string): { cleanName: string; stripeId: string } {
  const stripeMatch = name.match(/\b(cus_[A-Za-z0-9]+)\b/)
  if (stripeMatch) {
    const stripeId = stripeMatch[1]
    const cleanName = name.replace(stripeMatch[0], '').replace(/\s{2,}/g, ' ').trim()
    return { cleanName, stripeId }
  }
  return { cleanName: name, stripeId: '' }
}

/**
 * Check if firstName/lastName duplicates the organization name.
 * If the full name equals the org (case-insensitive), clear the person name fields.
 * This prevents displaying "Example Co. - Example Co.".
 */
function deduplicateClientNameVsOrg(
  firstName: string,
  lastName: string,
  organization: string
): { firstName: string; lastName: string } {
  if (!organization) return { firstName, lastName }
  const fullName = `${firstName} ${lastName}`.trim()
  if (fullName.toLowerCase() === organization.toLowerCase()) {
    return { firstName: '', lastName: '' }
  }
  return { firstName, lastName }
}

// -----------------------------------------------------------
// Raw data types
// -----------------------------------------------------------

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

interface RawLineItem {
  title?: string
  description: string
  rate: string
  qty: string
  line_total: string
  tax_codes: string[]
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
  line_items: RawLineItem[]
  notes?: string
  terms?: string
}

interface RawEstimate {
  fb_id: string
  estimate_number: string
  status: string
  currency: string
  date_issued: string
  billed_to: string
  subtotal: string
  tax_totals: { name: string; amount: string }[]
  total: string
  line_items: RawLineItem[]
  notes?: string
  terms?: string
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

interface RawItem {
  name: string
  description: string
  taxes: string
  rate: string
  type?: string
}

// -----------------------------------------------------------
// Load JSON
// -----------------------------------------------------------

function loadJSON<T>(filename: string): T {
  const filePath = path.join(DATA_DIR, filename)
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as T
}

// -----------------------------------------------------------
// Main seed function
// -----------------------------------------------------------

async function main() {
  console.log('Starting seed...')

  // ----- 0a. Company Settings (singleton) -----
  console.log('Seeding company settings...')
  const companyValues = {
    name: 'Example Co.',
    legalName: 'Example Co. Inc.',
    logoInitials: 'EC',
    addressLine1: '123 Main Street',
    addressLine2: '',
    city: 'Calgary',
    province: 'AB',
    postalCode: 'T0A0A0',
    country: 'Canada',
    phone: '+1-555-000-0000',
    email: 'postmaster@example.com',
    website: 'books.example.com',
    defaultCurrency: 'CAD',
    defaultPaymentTerms: 'net30',
  }
  await prisma.companySettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', ...companyValues },
    update: companyValues,
  })
  console.log('Company settings seeded.')

  // ----- 0. Admin User -----
  console.log('Seeding admin user...')
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com'
  const adminPassword = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'changeme', 12)
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: 'Admin',
      hashedPassword: adminPassword,
    },
    create: {
      name: 'Admin',
      email: adminEmail,
      hashedPassword: adminPassword,
    },
  })
  console.log(`Admin user seeded: ${adminEmail}`)

  // ----- 1. Clients -----
  const rawClients = loadJSON<RawClient[]>('clients.json')
  console.log(`Seeding ${rawClients.length} clients...`)

  const clientMap = new Map<string, string>() // fb_id -> db id
  const clientNameMap = new Map<string, string>() // "fname lname" or "fname" or org -> db id

  for (const c of rawClients) {
    // O3: Clean Stripe customer IDs from names
    const { cleanName: cleanFirstName, stripeId: stripeIdFirst } = cleanClientName(c.fname)
    const { cleanName: cleanLastName, stripeId: stripeIdLast } = cleanClientName(c.lname)
    const { cleanName: cleanOrg, stripeId: stripeIdOrg } = cleanClientName(c.organization || '')

    // Collect any Stripe IDs found
    const stripeIds = [stripeIdFirst, stripeIdLast, stripeIdOrg].filter(Boolean)
    const internalNote = stripeIds.length > 0 ? `Stripe: ${stripeIds.join(', ')}` : ''

    // O7: Deduplicate name vs organization
    const { firstName: dedupFirst, lastName: dedupLast } = deduplicateClientNameVsOrg(
      cleanFirstName,
      cleanLastName,
      cleanOrg
    )

    const client = await prisma.client.upsert({
      where: { fbId: c.fb_id },
      update: {
        firstName: dedupFirst,
        lastName: dedupLast,
        organization: cleanOrg,
        email: c.email || '',
        phone: c.phonenumber || '',
        address: c.address || '',
        currency: c.currency || 'CAD',
        internalNote,
      },
      create: {
        id: c.id,
        fbId: c.fb_id,
        firstName: dedupFirst,
        lastName: dedupLast,
        organization: cleanOrg,
        email: c.email || '',
        phone: c.phonenumber || '',
        address: c.address || '',
        currency: c.currency || 'CAD',
        internalNote,
      },
    })

    clientMap.set(c.fb_id, client.id)

    // Build name lookup maps (multiple keys can point to same client)
    // Use original names for lookup since invoice billed_to uses original names
    const fullName = `${c.fname} ${c.lname}`.trim()
    clientNameMap.set(fullName, client.id)
    // Also map first name only as a fallback
    if (c.fname) clientNameMap.set(c.fname, client.id)
    // Also map organization
    if (c.organization) clientNameMap.set(c.organization, client.id)
    // Also map cleaned names
    const cleanFullName = `${dedupFirst} ${dedupLast}`.trim()
    if (cleanFullName && cleanFullName !== fullName) {
      clientNameMap.set(cleanFullName, client.id)
    }
    if (cleanOrg && cleanOrg !== c.organization) {
      clientNameMap.set(cleanOrg, client.id)
    }
  }

  console.log(`Clients seeded. ${clientMap.size} in map.`)

  // ----- 2. Invoices -----
  const rawInvoices = loadJSON<RawInvoice[]>('invoices.json')
  console.log(`Seeding ${rawInvoices.length} invoices...`)

  const invoiceNumberToIdMap = new Map<string, string>() // invoice_number -> db id
  const invoiceNumberToClientIdMap = new Map<string, string>() // invoice_number -> client db id
  const seenInvoiceNumbers = new Set<string>()

  for (const inv of rawInvoices) {
    // Skip duplicate invoice numbers (keep the first occurrence by fb_id)
    if (seenInvoiceNumbers.has(inv.invoice_number) && !await prisma.invoice.findUnique({ where: { fbId: inv.fb_id } })) {
      console.log(`  Skipping duplicate invoice_number ${inv.invoice_number} (fb_id: ${inv.fb_id})`)
      continue
    }
    seenInvoiceNumbers.add(inv.invoice_number)
    // Find client by billed_to name
    let clientId = clientNameMap.get(inv.billed_to)

    // Try partial matches if exact match fails
    if (!clientId) {
      // Try matching last name + first name components
      for (const [name, id] of clientNameMap.entries()) {
        if (inv.billed_to.includes(name) || name.includes(inv.billed_to)) {
          clientId = id
          break
        }
      }
    }

    if (!clientId) {
      // Auto-create client from billed_to name
      const nameParts = inv.billed_to.trim().split(/\s+/)
      const firstName = nameParts[0] || inv.billed_to
      const lastName = nameParts.slice(1).join(' ') || ''
      const autoClient = await prisma.client.create({
        data: {
          firstName,
          lastName,
          organization: lastName ? '' : firstName,
          currency: inv.currency || 'CAD',
        },
      })
      clientId = autoClient.id
      const fullName = `${firstName} ${lastName}`.trim()
      clientNameMap.set(fullName, autoClient.id)
      clientNameMap.set(inv.billed_to, autoClient.id)
      console.log(`  Auto-created client "${inv.billed_to}" for invoice ${inv.invoice_number}`)
    }

    // Calculate tax total from array
    const taxTotal = (inv.tax_totals || []).reduce((sum, t) => {
      return sum + parseAmount(t.amount)
    }, 0)

    const subtotal = parseAmount(inv.subtotal)
    const total = parseAmount(inv.total)
    const amountPaid = parseAmount(inv.amount_paid)
    // amount_due may be empty in the export — compute from total - amountPaid
    const rawAmountDue = parseAmount(inv.amount_due)
    const amountDue = rawAmountDue > 0 ? rawAmountDue : Math.max(0, total - amountPaid)

    const shareToken = generateShareToken()

    // Use the actual status from the export (not overriding)
    // Empty status = draft
    const status = inv.status?.trim() || 'draft'
    // O9: Use actual currency per invoice from the export
    // A6/O5: Use actual date_due from the JSON (not date_issued + 60 days)
    const invoice = await prisma.invoice.upsert({
      where: { fbId: inv.fb_id },
      update: {
        invoiceNumber: inv.invoice_number,
        status,
        currency: inv.currency || 'CAD',
        dateIssued: parseDateString(inv.date_issued),
        dateDue: parseDateString(inv.date_due),
        subtotal,
        taxTotal,
        total,
        amountPaid,
        amountDue,
        notes: inv.notes || '',
        terms: inv.terms || '',
        clientId,
      },
      create: {
        fbId: inv.fb_id,
        invoiceNumber: inv.invoice_number,
        status,
        currency: inv.currency || 'CAD',
        dateIssued: parseDateString(inv.date_issued),
        dateDue: parseDateString(inv.date_due),
        subtotal,
        taxTotal,
        total,
        amountPaid,
        amountDue,
        notes: inv.notes || '',
        terms: inv.terms || '',
        shareToken,
        clientId,
      },
    })

    invoiceNumberToIdMap.set(inv.invoice_number, invoice.id)
    invoiceNumberToClientIdMap.set(inv.invoice_number, clientId)

    // Delete existing line items for idempotency, then re-create
    await prisma.invoiceLineItem.deleteMany({
      where: { invoiceId: invoice.id },
    })

    for (let i = 0; i < inv.line_items.length; i++) {
      const li = inv.line_items[i]
      // O4: Strip +GST from descriptions; tax info belongs in taxCodes
      const description = cleanLineItemDescription(li.description)
      const title = (li.title || '').trim()
      await prisma.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          title,
          description,
          rate: parseAmount(li.rate),
          quantity: parseFloat(li.qty) || 0,
          lineTotal: parseAmount(li.line_total),
          taxCodes: li.tax_codes || [],
          sortOrder: i,
        },
      })
    }
  }

  console.log(`Invoices seeded. ${invoiceNumberToIdMap.size} created.`)

  // ----- 3. Estimates -----
  const rawEstimates = loadJSON<RawEstimate[]>('estimates.json')
  console.log(`Seeding ${rawEstimates.length} estimates...`)

  for (const est of rawEstimates) {
    let clientId = clientNameMap.get(est.billed_to)

    if (!clientId) {
      for (const [name, id] of clientNameMap.entries()) {
        if (est.billed_to.includes(name) || name.includes(est.billed_to)) {
          clientId = id
          break
        }
      }
    }

    if (!clientId) {
      const nameParts = est.billed_to.trim().split(/\s+/)
      const firstName = nameParts[0] || est.billed_to
      const lastName = nameParts.slice(1).join(' ') || ''
      const autoClient = await prisma.client.create({
        data: {
          firstName,
          lastName,
          organization: lastName ? '' : firstName,
          currency: est.currency || 'CAD',
        },
      })
      clientId = autoClient.id
      clientNameMap.set(est.billed_to, autoClient.id)
      console.log(`  Auto-created client "${est.billed_to}" for estimate ${est.estimate_number}`)
    }

    const taxTotal = (est.tax_totals || []).reduce((sum, t) => {
      return sum + parseAmount(t.amount)
    }, 0)

    const shareToken = generateShareToken()

    // O8: Use actual status from export — empty = draft
    const estStatus = est.status?.trim() || 'draft'
    // O9: Use actual currency from export
    const estimate = await prisma.estimate.upsert({
      where: { fbId: est.fb_id },
      update: {
        estimateNumber: est.estimate_number,
        status: estStatus,
        currency: est.currency || 'CAD',
        dateIssued: parseDateString(est.date_issued),
        subtotal: parseAmount(est.subtotal),
        taxTotal,
        total: parseAmount(est.total),
        notes: est.notes || '',
        terms: est.terms || '',
        clientId,
      },
      create: {
        fbId: est.fb_id,
        estimateNumber: est.estimate_number,
        status: estStatus,
        currency: est.currency || 'CAD',
        dateIssued: parseDateString(est.date_issued),
        subtotal: parseAmount(est.subtotal),
        taxTotal,
        total: parseAmount(est.total),
        notes: est.notes || '',
        terms: est.terms || '',
        shareToken,
        clientId,
      },
    })

    // Delete existing line items for idempotency
    await prisma.estimateLineItem.deleteMany({
      where: { estimateId: estimate.id },
    })

    for (let i = 0; i < est.line_items.length; i++) {
      const li = est.line_items[i]
      // O4: Strip +GST from descriptions
      const description = cleanLineItemDescription(li.description)
      const title = (li.title || '').trim()
      await prisma.estimateLineItem.create({
        data: {
          estimateId: estimate.id,
          title,
          description,
          rate: parseAmount(li.rate),
          quantity: parseFloat(li.qty) || 0,
          lineTotal: parseAmount(li.line_total),
          taxCodes: li.tax_codes || [],
          sortOrder: i,
        },
      })
    }
  }

  console.log(`Estimates seeded.`)

  // ----- 4. Payments -----
  const rawPayments = loadJSON<RawPayment[]>('payments.json')
  console.log(`Seeding ${rawPayments.length} payments...`)

  // First delete all existing payments for idempotency
  await prisma.payment.deleteMany({})

  let paymentsCreated = 0
  let paymentsSkipped = 0

  for (const pay of rawPayments) {
    const invoiceId = invoiceNumberToIdMap.get(pay.invoice_number)
    const clientId = invoiceNumberToClientIdMap.get(pay.invoice_number)

    if (!invoiceId || !clientId) {
      console.warn(`  WARNING: No invoice found for payment on invoice_number: "${pay.invoice_number}". Skipping.`)
      paymentsSkipped++
      continue
    }

    await prisma.payment.create({
      data: {
        paymentDate: parseDateString(pay.payment_date),
        paymentMethod: pay.payment_method || 'Other',
        amount: parseAmount(pay.amount),
        currency: pay.currency || 'CAD',
        notes: pay.notes || '',
        status: pay.status || 'paid',
        invoiceId,
        clientId,
      },
    })

    paymentsCreated++
  }

  console.log(`Payments seeded. ${paymentsCreated} created, ${paymentsSkipped} skipped.`)

  // ----- 5. Items (deduplicate by name, skip separator rows) -----
  const rawItems = loadJSON<RawItem[]>('items.json')
  console.log(`Seeding items (raw: ${rawItems.length}, deduplicating by name)...`)

  const seenItemNames = new Set<string>()
  const uniqueItems: RawItem[] = []

  for (const item of rawItems) {
    // A2: Skip rows where name is just dashes (separator rows like "----------")
    if (!item.name || /^-+$/.test(item.name.trim())) {
      continue
    }

    if (!seenItemNames.has(item.name)) {
      seenItemNames.add(item.name)
      uniqueItems.push(item)
    }
  }

  console.log(`Unique items after filtering: ${uniqueItems.length}`)

  for (const item of uniqueItems) {
    // A2: Parse rate correctly - handles currency symbols and codes like "€250.00 EUR" or "-€250.00 EUR"
    const rate = parseAmount(item.rate)

    // Upsert by name (use findFirst + upsert pattern since name is not unique in schema)
    const existing = await prisma.item.findFirst({
      where: { name: item.name },
    })

    if (existing) {
      await prisma.item.update({
        where: { id: existing.id },
        data: {
          description: item.description || '',
          rate,
          taxes: item.taxes || '',
          category: item.type || 'service',
        },
      })
    } else {
      await prisma.item.create({
        data: {
          name: item.name,
          description: item.description || '',
          rate,
          taxes: item.taxes || '',
          category: item.type || 'service',
        },
      })
    }
  }

  console.log(`Items seeded.`)

  console.log('\nSeed complete!')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
