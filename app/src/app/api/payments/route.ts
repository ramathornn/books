import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { paymentSchema } from '@/lib/validators'

export async function GET(request: NextRequest) {
  // Read access via Bearer token (headless agents) OR an interactive session.
  // POST below stays session-only, so a token can read but not create payments.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100)
  const invoiceId = searchParams.get('invoiceId')
  const clientId = searchParams.get('clientId')
  const currency = searchParams.get('currency')
  const search = searchParams.get('search')
  const sortBy = searchParams.get('sortBy') || 'paymentDate'
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc'

  const where: Record<string, unknown> = {}

  if (invoiceId) {
    where.invoiceId = invoiceId
  }

  if (clientId) {
    where.clientId = clientId
  }

  if (currency) {
    where.currency = currency
  }

  if (search) {
    where.OR = [
      { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      { client: { firstName: { contains: search, mode: 'insensitive' } } },
      { client: { lastName: { contains: search, mode: 'insensitive' } } },
      { client: { organization: { contains: search, mode: 'insensitive' } } },
      { notes: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        invoice: { select: { id: true, invoiceNumber: true, total: true } },
        client: { select: { id: true, firstName: true, lastName: true, organization: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.payment.count({ where }),
  ])

  return Response.json({
    data: payments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}

export async function POST(request: NextRequest) {
  // Create via Bearer token (headless agents) OR an interactive session.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  try {
    const body = await request.json()
    const parsed = paymentSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { invoiceId, paymentDate, paymentMethod, amount, notes } = parsed.data

    // Verify invoice exists and get its client
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, clientId: true, total: true, amountPaid: true, currency: true },
    })

    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Create the payment
    const payment = await prisma.payment.create({
      data: {
        paymentDate: new Date(paymentDate),
        paymentMethod,
        amount,
        currency: invoice.currency,
        notes: notes || '',
        status: 'paid',
        invoiceId,
        clientId: invoice.clientId,
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        client: { select: { id: true, firstName: true, lastName: true, organization: true } },
      },
    })

    // Update invoice amounts
    const totalPaid = Number(invoice.amountPaid) + amount
    const totalInvoice = Number(invoice.total)
    const newAmountDue = Math.max(0, totalInvoice - totalPaid)

    const newStatus = newAmountDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'sent'

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: totalPaid,
        amountDue: newAmountDue,
        status: newStatus,
      },
    })

    return Response.json(payment, { status: 201 })
  } catch (error) {
    console.error('Create payment error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
