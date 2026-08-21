import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { clientSchema } from '@/lib/validators'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 500)
  const search = searchParams.get('search')
  const currency = searchParams.get('currency')
  const sortBy = searchParams.get('sortBy') || 'lastName'
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc'

  const where: Record<string, unknown> = {}

  if (currency) {
    where.currency = currency
  }

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { organization: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where,
      include: {
        _count: {
          select: {
            invoices: true,
            estimates: true,
            payments: true,
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.client.count({ where }),
  ])

  return Response.json({
    data: clients,
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
    const parsed = clientSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const client = await prisma.client.create({
      data: parsed.data,
    })

    return Response.json(client, { status: 201 })
  } catch (error) {
    console.error('Create client error:', error)
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500 })
  }
}
