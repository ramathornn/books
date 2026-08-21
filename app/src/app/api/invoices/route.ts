import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { invoiceSchema } from '@/lib/validators'
import { generateShareToken, formatInvoiceNumber } from '@/lib/utils'

export async function GET(request: NextRequest) {
  // Read access via Bearer token (headless agents) OR an interactive session.
  // POST below stays session-only, so a token can read but not create invoices.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  // Accountant sessions never see drafts (unsent working documents).
  // Bearer-token agents (no session) keep full visibility.
  const session = authed.via === 'session' ? await auth() : null
  const hideDrafts = session?.user?.role === 'accountant'

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100)
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const currency = searchParams.get('currency')
  const clientId = searchParams.get('clientId')
  const sortBy = searchParams.get('sortBy') || 'dateIssued'
  const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc'

  const where: Record<string, unknown> = {}

  if (status) {
    where.status = status
  }

  if (currency) {
    where.currency = currency
  }

  if (clientId) {
    where.clientId = clientId
  }

  if (search) {
    where.OR = [
      { invoiceNumber: { contains: search, mode: 'insensitive' } },
      { client: { firstName: { contains: search, mode: 'insensitive' } } },
      { client: { lastName: { contains: search, mode: 'insensitive' } } },
      { client: { organization: { contains: search, mode: 'insensitive' } } },
    ]
  }

  if (hideDrafts) {
    where.AND = [...((where.AND as unknown[] | undefined) ?? []), { status: { not: 'draft' } }]
  }

  const [invoices, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { payments: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.invoice.count({ where }),
  ])

  return Response.json({
    data: invoices,
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
  // Session is optional (bearer callers have none); used only to look up the
  // creating user's per-invoice default toggles below.
  const session = await auth()

  try {
    const body = await request.json()
    const parsed = invoiceSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { clientId, currency, dateIssued, dateDue, lineItems, description, reference, notes, terms, discount } = parsed.data

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Invoice number: honour an explicit one (validated unique), else auto-increment.
    let invoiceNumber: string
    const explicitNumber = parsed.data.invoiceNumber?.trim()
    if (explicitNumber) {
      const n = parseInt(explicitNumber, 10)
      if (!Number.isFinite(n) || n <= 0) {
        return Response.json(
          { error: 'invoiceNumber must be a positive number (e.g. "407")' },
          { status: 400 }
        )
      }
      invoiceNumber = formatInvoiceNumber(n)
      const clash = await prisma.invoice.findFirst({ where: { invoiceNumber } })
      if (clash) {
        return Response.json(
          { error: `Invoice number ${invoiceNumber} already exists` },
          { status: 409 }
        )
      }
    } else {
      const lastInvoice = await prisma.invoice.findFirst({
        orderBy: { invoiceNumber: 'desc' },
      })
      const nextNum = lastInvoice ? parseInt(lastInvoice.invoiceNumber, 10) + 1 : 1
      invoiceNumber = formatInvoiceNumber(nextNum)
    }

    // Calculate totals
    const calculatedLineItems = lineItems.map((li, index) => {
      const lineTotal = li.rate * li.quantity
      return {
        title: li.title,
        description: li.description,
        rate: li.rate,
        quantity: li.quantity,
        lineTotal,
        taxCodes: li.taxCodes,
        sortOrder: index,
      }
    })

    const subtotal = calculatedLineItems.reduce((sum, li) => sum + li.lineTotal, 0)
    const discountAmount = discount || 0

    // Calculate tax: parse NAME:RATE codes, fall back to 5% for bare GST codes
    let taxTotal = 0
    for (const li of calculatedLineItems) {
      for (const code of li.taxCodes) {
        const [, rateStr] = code.split(':')
        const rate = parseFloat(rateStr || '0') || (code.toUpperCase().includes('GST') ? 5 : 0)
        taxTotal += li.lineTotal * (rate / 100)
      }
    }

    const total = subtotal - discountAmount + taxTotal

    const shareToken = generateShareToken()

    const userEmail = session?.user?.email ?? null
    const currentUser = userEmail
      ? await prisma.user.findUnique({
          where: { email: userEmail },
          select: {
            defaultOnlinePaymentsEnabled: true,
            defaultAllowPartialPayments: true,
          },
        })
      : null

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        status: parsed.data.status || 'draft',
        currency,
        dateIssued: new Date(dateIssued),
        dateDue: new Date(dateDue),
        subtotal,
        taxTotal,
        total,
        amountPaid: 0,
        amountDue: total,
        description: description || '',
        reference: reference || '',
        notes: notes || '',
        terms: terms || '',
        discount: discountAmount,
        onlinePaymentsEnabled: currentUser?.defaultOnlinePaymentsEnabled ?? false,
        allowPartialPayments: currentUser?.defaultAllowPartialPayments ?? false,
        shareToken,
        clientId,
        lineItems: {
          create: calculatedLineItems,
        },
      },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return Response.json(invoice, { status: 201 })
  } catch (error) {
    console.error('Create invoice error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
