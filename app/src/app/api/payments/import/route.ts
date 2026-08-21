import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { pickField } from '@/lib/csv'

interface ImportError {
  row: number
  message: string
}

function parseCsvDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null
  const trimmed = raw.trim()
  const usMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (usMatch) {
    const [, m, d, y] = usMatch
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    if (!Number.isNaN(dt.getTime())) return dt
  }
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
  let imported = 0

  // Pre-load invoices for any referenced numbers
  const allInvoiceNumbers = Array.from(
    new Set(
      incoming
        .map((r) =>
          pickField(r, ['Invoice Number', 'invoice_number']).trim()
        )
        .filter(Boolean)
    )
  )
  const invoices = allInvoiceNumbers.length
    ? await prisma.invoice.findMany({
        where: { invoiceNumber: { in: allInvoiceNumbers } },
        select: {
          id: true,
          invoiceNumber: true,
          clientId: true,
          currency: true,
          total: true,
          amountPaid: true,
        },
      })
    : []
  const invoiceByNum = new Map(invoices.map((i) => [i.invoiceNumber, i]))

  for (let i = 0; i < incoming.length; i++) {
    const rowNum = i + 2
    const raw = incoming[i]

    const paymentDateRaw = pickField(raw, [
      'Payment Date',
      'payment_date',
      'date',
    ])
    const invoiceNumber = pickField(raw, [
      'Invoice Number',
      'invoice_number',
    ]).trim()
    const amountRaw = pickField(raw, ['Amount', 'amount'])
    const currencyRaw = pickField(raw, ['Currency', 'currency']).trim()
    const paymentMethod =
      pickField(raw, ['Payment Method', 'payment_method', 'method']).trim() ||
      'other'
    const notes = pickField(raw, ['Notes', 'notes'])

    const paymentDate = parseCsvDate(paymentDateRaw)
    if (!paymentDate) {
      errors.push({ row: rowNum, message: 'Missing or invalid Payment Date' })
      continue
    }
    if (!invoiceNumber) {
      errors.push({ row: rowNum, message: 'Missing Invoice Number' })
      continue
    }
    const amount = parseNum(amountRaw)
    if (amount == null || amount <= 0) {
      errors.push({ row: rowNum, message: 'Missing or invalid Amount' })
      continue
    }

    const invoice = invoiceByNum.get(invoiceNumber)
    if (!invoice) {
      errors.push({
        row: rowNum,
        message: `No invoice found with number "${invoiceNumber}"`,
      })
      continue
    }

    const total = Number(invoice.total)
    const currentPaid = Number(invoice.amountPaid)
    const requested = currentPaid + amount
    let appliedAmount = amount
    let overpaidWarning = false
    if (requested > total) {
      appliedAmount = Math.max(0, total - currentPaid)
      overpaidWarning = true
    }

    if (appliedAmount <= 0) {
      errors.push({
        row: rowNum,
        message: `Invoice "${invoiceNumber}" is already fully paid`,
      })
      // mutate cached state so subsequent rows for same invoice reflect this
      continue
    }

    const currency = currencyRaw ? currencyRaw.toUpperCase() : invoice.currency

    try {
      await prisma.payment.create({
        data: {
          paymentDate,
          paymentMethod,
          amount: appliedAmount,
          currency,
          notes: notes || '',
          status: 'paid',
          source: 'manual',
          invoiceId: invoice.id,
          clientId: invoice.clientId,
        },
      })

      const newTotalPaid = currentPaid + appliedAmount
      const newAmountDue = Math.max(0, total - newTotalPaid)
      const newStatus =
        newAmountDue <= 0 ? 'paid' : newTotalPaid > 0 ? 'partial' : 'sent'

      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: newTotalPaid,
          amountDue: newAmountDue,
          status: newStatus,
        },
      })

      // Refresh in-memory snapshot for any subsequent rows targeting the
      // same invoice
      invoiceByNum.set(invoiceNumber, {
        ...invoice,
        amountPaid: newTotalPaid as unknown as typeof invoice.amountPaid,
      })

      imported++
      if (overpaidWarning) {
        errors.push({
          row: rowNum,
          message: `Amount clamped to ${appliedAmount.toFixed(2)} to avoid overpaying invoice "${invoiceNumber}"`,
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      errors.push({ row: rowNum, message: `Database error: ${msg}` })
    }
  }

  return Response.json({ imported, errors })
}
