import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { advanceDate, type IntervalUnit } from '@/lib/recurring'
import { createJournalEntry } from '@/lib/journalEntry'
import { getCompanySettings } from '@/lib/company'

interface ExpensePayload {
  categoryId?: string
  vendorId?: string | null
  clientId?: string | null
  projectId?: string | null
  amount?: number
  taxAmount?: number
  currency?: string
  description?: string
  notes?: string
  taxCodeId?: string | null
}

interface BillPayload {
  vendorId?: string | null
  currency?: string
  notes?: string
  reference?: string
  daysUntilDue?: number
  lines?: Array<{
    description?: string
    amount: number
    taxAmount?: number
    categoryGlAccountId?: string | null
    taxCodeId?: string | null
  }>
}

interface JEPayload {
  description?: string
  memo?: string
  lines?: Array<{
    glAccountId: string
    description?: string
    debit: number
    credit: number
    taxCodeId?: string | null
  }>
}

interface InvoicePayload {
  clientId: string
  daysUntilDue?: number
  currency?: string
  notes?: string
  terms?: string
  reference?: string
  lineItems?: Array<{
    title?: string
    description?: string
    rate: number
    quantity: number
    taxCodes?: string[]
  }>
}

// Manually run a recurring template: clone the payload into a real transaction.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const t = await prisma.recurringTemplate.findUnique({ where: { id } })
  if (!t) return Response.json({ error: 'Not found' }, { status: 404 })
  if (!t.isActive) return Response.json({ error: 'Template is inactive' }, { status: 400 })

  const runDate = t.nextRunDate || t.startDate
  const payload = (t.payload as Record<string, unknown>) || {}
  let createdId: string | null = null
  let createdType: string | null = null

  try {
    if (t.transactionType === 'expense') {
      const ex = payload as ExpensePayload
      if (!ex.categoryId || !ex.amount) {
        return Response.json({ error: 'Template payload missing categoryId or amount.' }, { status: 400 })
      }
      const total = Number(ex.amount) + Number(ex.taxAmount || 0)
      const created = await prisma.expense.create({
        data: {
          date: runDate,
          amount: ex.amount,
          taxAmount: ex.taxAmount || 0,
          total,
          currency: ex.currency || 'CAD',
          description: ex.description || t.templateName,
          notes: ex.notes || '',
          status: 'pending',
          source: (await getCompanySettings()).name,
          categoryId: ex.categoryId,
          vendorId: ex.vendorId || null,
          clientId: ex.clientId || null,
          projectId: ex.projectId || null,
          taxCodeId: ex.taxCodeId || null,
          isRecurring: true,
          recurringFrequency: t.intervalUnit,
        },
      })
      createdId = created.id
      createdType = 'expense'
    } else if (t.transactionType === 'bill') {
      const bp = payload as BillPayload
      if (!bp.lines?.length) {
        return Response.json({ error: 'Template payload has no lines.' }, { status: 400 })
      }
      const dueDate = new Date(runDate.getTime() + ((bp.daysUntilDue ?? 30) * 86400000))
      const subtotal = bp.lines.reduce((s, l) => s + Number(l.amount || 0), 0)
      const taxTotal = bp.lines.reduce((s, l) => s + Number(l.taxAmount || 0), 0)
      const total = subtotal + taxTotal
      // Generate a fresh bill number
      const last = await prisma.bill.findFirst({
        where: { billNumber: { startsWith: 'BILL-' } },
        orderBy: { billNumber: 'desc' },
        select: { billNumber: true },
      })
      const n = last ? parseInt(last.billNumber.replace(/^BILL-/, ''), 10) || 0 : 0
      const billNumber = `BILL-${String(n + 1).padStart(5, '0')}`
      const created = await prisma.bill.create({
        data: {
          billNumber,
          vendorId: bp.vendorId || null,
          billDate: runDate,
          dueDate,
          currency: bp.currency || 'CAD',
          subtotal,
          taxTotal,
          total,
          amountDue: total,
          status: 'draft',
          notes: bp.notes || '',
          reference: bp.reference || `Recurring: ${t.templateName}`,
          lines: {
            create: bp.lines.map((l, i) => ({
              description: l.description || '',
              amount: Number(l.amount),
              taxAmount: Number(l.taxAmount || 0),
              categoryGlAccountId: l.categoryGlAccountId || null,
              taxCodeId: l.taxCodeId || null,
              sortOrder: i,
            })),
          },
        },
      })
      createdId = created.id
      createdType = 'bill'
    } else if (t.transactionType === 'journal_entry') {
      const je = payload as JEPayload
      if (!je.lines?.length) {
        return Response.json({ error: 'Template payload has no JE lines.' }, { status: 400 })
      }
      const created = await createJournalEntry({
        entryDate: runDate,
        description: je.description || t.templateName,
        memo: je.memo || `Recurring: ${t.templateName}`,
        status: 'posted',
        lines: je.lines.map((l) => ({
          glAccountId: l.glAccountId,
          description: l.description || '',
          debit: l.debit,
          credit: l.credit,
          taxCodeId: l.taxCodeId ?? null,
        })),
      })
      createdId = created.id
      createdType = 'journal_entry'
    } else if (t.transactionType === 'invoice') {
      const inv = payload as unknown as InvoicePayload
      if (!inv.clientId || !inv.lineItems?.length) {
        return Response.json({ error: 'Template payload missing clientId or lineItems.' }, { status: 400 })
      }
      const subtotal = inv.lineItems.reduce((s, l) => s + Number(l.rate) * Number(l.quantity), 0)
      const dueDate = new Date(runDate.getTime() + ((inv.daysUntilDue ?? 30) * 86400000))
      const last = await prisma.invoice.findFirst({
        where: { invoiceNumber: { startsWith: 'INV-' } },
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true },
      })
      const n = last ? parseInt(last.invoiceNumber.replace(/^INV-/, ''), 10) || 0 : 0
      const invoiceNumber = `INV-${String(n + 1).padStart(5, '0')}`
      const created = await prisma.invoice.create({
        data: {
          invoiceNumber,
          status: 'draft',
          currency: inv.currency || 'CAD',
          dateIssued: runDate,
          dateDue: dueDate,
          subtotal,
          taxTotal: 0,
          total: subtotal,
          amountDue: subtotal,
          shareToken: crypto.randomUUID(),
          clientId: inv.clientId,
          notes: inv.notes || '',
          terms: inv.terms || '',
          reference: inv.reference || `Recurring: ${t.templateName}`,
          lineItems: {
            create: inv.lineItems.map((l, i) => ({
              title: l.title || '',
              description: l.description || '',
              rate: Number(l.rate),
              quantity: Number(l.quantity),
              lineTotal: Number(l.rate) * Number(l.quantity),
              taxCodes: l.taxCodes || [],
              sortOrder: i,
            })),
          },
        },
      })
      createdId = created.id
      createdType = 'invoice'
    } else {
      return Response.json({ error: `Unsupported transactionType: ${t.transactionType}` }, { status: 400 })
    }
  } catch (e) {
    console.error('Recurring run failed', e)
    return Response.json({ error: e instanceof Error ? e.message : 'Run failed' }, { status: 500 })
  }

  // Advance the schedule
  const next = advanceDate(runDate, t.intervalUnit as IntervalUnit, t.intervalCount)
  await prisma.recurringTemplate.update({
    where: { id: t.id },
    data: {
      previousRunDate: runDate,
      nextRunDate: t.endDate && next > t.endDate ? null : next,
      runCount: { increment: 1 },
      isActive: t.endDate && next > t.endDate ? false : t.isActive,
    },
  })

  return Response.json({ ok: true, createdType, createdId, advancedTo: next })
}
