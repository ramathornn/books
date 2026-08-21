import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { pickField } from '@/lib/csv'
import { generateShareToken, formatInvoiceNumber } from '@/lib/utils'

interface ImportError {
  row: number
  message: string
}

const VALID_STATUSES = new Set([
  'draft',
  'sent',
  'viewed',
  'partial',
  'paid',
  'overdue',
])

function parseCsvDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null
  const trimmed = raw.trim()

  // MM/DD/YYYY
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, m, d, y] = usMatch
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    if (!Number.isNaN(dt.getTime())) return dt
  }

  // YYYY-MM-DD or full ISO
  const dt = new Date(trimmed)
  if (!Number.isNaN(dt.getTime())) return dt
  return null
}

function parseNum(raw: string): number | null {
  if (raw == null) return null
  const cleaned = String(raw).replace(/[,$\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  return n
}

interface PreparedRow {
  rowNum: number
  invoiceNumber: string // user-provided; "" means auto-generate one per group
  clientEmail: string
  status: string
  dateIssued: Date
  dateDue: Date | null
  currency: string
  description: string
  reference: string
  lineDescription: string
  lineRate: number
  lineQuantity: number
  groupKey: string // invoice number (or `__row_<n>` if blank)
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { rows?: Record<string, string>[] }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const incoming = Array.isArray(body.rows) ? body.rows : []
  const errors: ImportError[] = []
  const prepared: PreparedRow[] = []

  // Phase 1: validate + normalize each row
  for (let i = 0; i < incoming.length; i++) {
    const rowNum = i + 2 // header is row 1 in user-facing terms
    const raw = incoming[i]

    const invoiceNumber = pickField(raw, ['Invoice Number', 'invoice_number'])
      .trim()
    const clientEmail = pickField(raw, ['Client Email', 'client_email', 'email'])
      .trim()
      .toLowerCase()
    const statusRaw = pickField(raw, ['Status', 'status']).trim().toLowerCase()
    const status =
      statusRaw && VALID_STATUSES.has(statusRaw) ? statusRaw : 'draft'
    const dateIssuedRaw = pickField(raw, ['Date Issued', 'date_issued', 'issued'])
    const dateDueRaw = pickField(raw, ['Date Due', 'date_due', 'due'])
    const currency = (
      pickField(raw, ['Currency', 'currency']).trim() || 'CAD'
    ).toUpperCase()
    const description = pickField(raw, ['Description', 'description'])
    const reference = pickField(raw, ['Reference', 'reference'])
    const lineDescription = pickField(raw, [
      'Line Description',
      'line_description',
      'item description',
      'item',
    ])
    const lineRate = parseNum(pickField(raw, ['Line Rate', 'line_rate', 'rate']))
    const lineQuantity = parseNum(
      pickField(raw, ['Line Quantity', 'line_quantity', 'quantity', 'qty'])
    )

    if (!clientEmail) {
      errors.push({ row: rowNum, message: 'Missing client email' })
      continue
    }
    const dateIssued = parseCsvDate(dateIssuedRaw)
    if (!dateIssued) {
      errors.push({ row: rowNum, message: 'Missing or invalid Date Issued' })
      continue
    }
    if (lineRate == null) {
      errors.push({ row: rowNum, message: 'Missing or invalid Line Rate' })
      continue
    }
    if (lineQuantity == null) {
      errors.push({ row: rowNum, message: 'Missing or invalid Line Quantity' })
      continue
    }

    const dateDue = parseCsvDate(dateDueRaw) // optional, defaults to issued
    const groupKey = invoiceNumber || `__row_${rowNum}`

    prepared.push({
      rowNum,
      invoiceNumber,
      clientEmail,
      status,
      dateIssued,
      dateDue,
      currency,
      description,
      reference,
      lineDescription,
      lineRate,
      lineQuantity,
      groupKey,
    })
  }

  // Phase 2: aggregate by groupKey (invoice number) — each group becomes
  // one invoice with N line items.
  const groups = new Map<string, PreparedRow[]>()
  for (const p of prepared) {
    const arr = groups.get(p.groupKey) ?? []
    arr.push(p)
    groups.set(p.groupKey, arr)
  }

  // Look up clients for all unique emails
  const allEmails = Array.from(
    new Set(prepared.map((p) => p.clientEmail))
  ).filter(Boolean)
  const clients = allEmails.length
    ? await prisma.client.findMany({
        where: {
          email: { in: allEmails, mode: 'insensitive' },
        },
        select: { id: true, email: true },
      })
    : []
  const clientByEmail = new Map(
    clients.map((c) => [c.email.toLowerCase(), c.id])
  )

  // Pre-compute next invoice number for auto-generated cases
  const lastInvoice = await prisma.invoice.findFirst({
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })
  let nextSeq = lastInvoice
    ? parseInt(lastInvoice.invoiceNumber, 10) + 1
    : 1
  if (!Number.isFinite(nextSeq) || nextSeq < 1) nextSeq = 1

  let imported = 0

  for (const [, rowsInGroup] of groups) {
    const head = rowsInGroup[0]
    const clientId = clientByEmail.get(head.clientEmail)
    if (!clientId) {
      // Report against every row in the group
      for (const r of rowsInGroup) {
        errors.push({
          row: r.rowNum,
          message: `No client found with email "${head.clientEmail}"`,
        })
      }
      continue
    }

    // Resolve invoice number — use provided, else auto.
    let invoiceNumber = head.invoiceNumber
    if (invoiceNumber) {
      const exists = await prisma.invoice.findUnique({
        where: { invoiceNumber },
        select: { id: true },
      })
      if (exists) {
        for (const r of rowsInGroup) {
          errors.push({
            row: r.rowNum,
            message: `Invoice number "${invoiceNumber}" already exists`,
          })
        }
        continue
      }
    } else {
      invoiceNumber = formatInvoiceNumber(nextSeq++)
    }

    const lineItemsData = rowsInGroup.map((r, idx) => ({
      title: '',
      description: r.lineDescription || '',
      rate: r.lineRate,
      quantity: r.lineQuantity,
      lineTotal: r.lineRate * r.lineQuantity,
      taxCodes: [] as string[],
      sortOrder: idx,
    }))

    const subtotal = lineItemsData.reduce((s, li) => s + li.lineTotal, 0)
    const taxTotal = 0
    const discount = 0
    const total = subtotal - discount + taxTotal
    const amountPaid = 0
    const amountDue = total

    try {
      await prisma.invoice.create({
        data: {
          invoiceNumber,
          status: head.status,
          currency: head.currency,
          dateIssued: head.dateIssued,
          dateDue: head.dateDue ?? head.dateIssued,
          subtotal,
          taxTotal,
          total,
          amountPaid,
          amountDue,
          description: head.description || '',
          reference: head.reference || '',
          notes: '',
          terms: '',
          discount,
          shareToken: generateShareToken(),
          clientId,
          lineItems: { create: lineItemsData },
        },
      })
      imported++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      for (const r of rowsInGroup) {
        errors.push({ row: r.rowNum, message: `Database error: ${msg}` })
      }
    }
  }

  return Response.json({ imported, errors })
}
