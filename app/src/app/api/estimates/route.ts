import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { estimateSchema } from '@/lib/validators'
import { generateShareToken, formatInvoiceNumber } from '@/lib/utils'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
      { estimateNumber: { contains: search, mode: 'insensitive' } },
      { client: { firstName: { contains: search, mode: 'insensitive' } } },
      { client: { lastName: { contains: search, mode: 'insensitive' } } },
      { client: { organization: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [estimates, total] = await Promise.all([
    prisma.estimate.findMany({
      where,
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.estimate.count({ where }),
  ])

  return Response.json({
    data: estimates,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const parsed = estimateSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { clientId, currency, dateIssued, lineItems, description, notes, terms } = parsed.data

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Get next estimate number
    const lastEstimate = await prisma.estimate.findFirst({
      orderBy: { estimateNumber: 'desc' },
    })
    const nextNum = lastEstimate
      ? parseInt(lastEstimate.estimateNumber, 10) + 1
      : 1
    const estimateNumber = formatInvoiceNumber(nextNum)

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

    let taxTotal = 0
    for (const li of calculatedLineItems) {
      if (li.taxCodes.length > 0) {
        for (const code of li.taxCodes) {
          if (code.toUpperCase().includes('GST')) {
            taxTotal += li.lineTotal * 0.05
          }
        }
      }
    }

    const total = subtotal + taxTotal
    const shareToken = generateShareToken()

    const estimate = await prisma.estimate.create({
      data: {
        estimateNumber,
        status: 'draft',
        currency,
        dateIssued: new Date(dateIssued),
        subtotal,
        taxTotal,
        total,
        description: description || '',
        notes: notes || '',
        terms: terms || '',
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

    return Response.json(estimate, { status: 201 })
  } catch (error) {
    console.error('Create estimate error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
