import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { generateShareToken, formatInvoiceNumber } from '@/lib/utils'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const source = await prisma.invoice.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })

    if (!source) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Compute next invoice number using the same logic as /api/invoices/next-number
    const lastInvoice = await prisma.invoice.findFirst({
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    })
    const nextNum = lastInvoice
      ? parseInt(lastInvoice.invoiceNumber, 10) + 1
      : 1
    const newInvoiceNumber = formatInvoiceNumber(nextNum)

    // dateIssued = today at 00:00 local time
    const newDateIssued = new Date()
    newDateIssued.setHours(0, 0, 0, 0)

    // Preserve source dateDue - dateIssued offset; fall back to +30 days
    const srcIssued = new Date(source.dateIssued)
    const srcDue = new Date(source.dateDue)
    const offsetMs = srcDue.getTime() - srcIssued.getTime()
    const offsetDays = Math.round(offsetMs / (1000 * 60 * 60 * 24))
    const dueOffsetDays = offsetDays > 0 ? offsetDays : 30
    const newDateDue = new Date(newDateIssued)
    newDateDue.setDate(newDateDue.getDate() + dueOffsetDays)

    const total = Number(source.total)
    const discount = Number(source.discount)
    const amountDue = total - discount

    const newShareToken = generateShareToken()

    const lineItemsToCreate = source.lineItems.map((li) => ({
      title: li.title,
      description: li.description,
      rate: li.rate,
      quantity: li.quantity,
      lineTotal: li.lineTotal,
      taxCodes: li.taxCodes,
      sortOrder: li.sortOrder,
    }))

    const newInvoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: newInvoiceNumber,
          status: 'draft',
          currency: source.currency,
          dateIssued: newDateIssued,
          dateDue: newDateDue,
          subtotal: source.subtotal,
          taxTotal: source.taxTotal,
          total: source.total,
          amountPaid: 0,
          amountDue,
          description: source.description,
          reference: source.reference,
          notes: source.notes,
          terms: source.terms,
          discount: source.discount,
          shareToken: newShareToken,
          clientId: source.clientId,
          onlinePaymentsEnabled: source.onlinePaymentsEnabled,
          allowPartialPayments: source.allowPartialPayments,
          sourceEstimateId: source.sourceEstimateId,
          lineItems: {
            create: lineItemsToCreate,
          },
        },
      })

      await tx.invoiceActivity.create({
        data: {
          invoiceId: created.id,
          type: 'created',
          description: `Duplicated from invoice #${source.invoiceNumber}`,
        },
      })

      return created
    })

    return Response.json({
      id: newInvoice.id,
      invoiceNumber: newInvoice.invoiceNumber,
    })
  } catch (error) {
    console.error('Duplicate invoice error:', error)
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
