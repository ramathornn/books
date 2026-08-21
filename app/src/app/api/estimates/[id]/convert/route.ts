import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { generateShareToken, formatInvoiceNumber } from '@/lib/utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const estimate = await prisma.estimate.findUnique({
      where: { id },
      include: {
        lineItems: { orderBy: { sortOrder: 'asc' } },
        client: true,
      },
    })

    if (!estimate) {
      return Response.json({ error: 'Estimate not found' }, { status: 404 })
    }

    // Get optional body params (e.g., dateDue override)
    let dateDue: Date
    try {
      const body = await request.json()
      dateDue = body.dateDue ? new Date(body.dateDue) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    } catch {
      // No body provided, default to 30 days from now
      dateDue = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }

    // Get next invoice number
    const lastInvoice = await prisma.invoice.findFirst({
      orderBy: { invoiceNumber: 'desc' },
    })
    const nextNum = lastInvoice
      ? parseInt(lastInvoice.invoiceNumber, 10) + 1
      : 1
    const invoiceNumber = formatInvoiceNumber(nextNum)

    const shareToken = generateShareToken()

    // Create the invoice from the estimate data
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        status: 'draft',
        currency: estimate.currency,
        dateIssued: new Date(),
        dateDue,
        subtotal: estimate.subtotal,
        taxTotal: estimate.taxTotal,
        total: estimate.total,
        amountPaid: 0,
        amountDue: estimate.total,
        notes: estimate.notes,
        terms: '',
        discount: 0,
        shareToken,
        clientId: estimate.clientId,
        sourceEstimateId: estimate.id,
        lineItems: {
          create: estimate.lineItems.map((li: typeof estimate.lineItems[number], index: number) => ({
            description: li.description,
            rate: li.rate,
            quantity: li.quantity,
            lineTotal: li.lineTotal,
            taxCodes: li.taxCodes,
            sortOrder: index,
          })),
        },
      },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })

    // Update estimate status to "invoiced"
    await prisma.estimate.update({
      where: { id },
      data: { status: 'invoiced' },
    })

    return Response.json(invoice, { status: 201 })
  } catch (error) {
    console.error('Convert estimate error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
