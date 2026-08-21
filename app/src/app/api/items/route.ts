import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { itemSchema } from '@/lib/validators'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get('page') || '1', 10)
  const limit = Math.min(parseInt(searchParams.get('limit') || '30', 10), 100)
  const search = searchParams.get('search')
  const category = searchParams.get('category')
  const sortBy = searchParams.get('sortBy') || 'name'
  const sortOrder = searchParams.get('sortOrder') === 'desc' ? 'desc' : 'asc'

  const where: Record<string, unknown> = {}

  if (category) {
    where.category = category
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.item.count({ where }),
  ])

  return Response.json({
    data: items,
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
    const parsed = itemSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const item = await prisma.item.create({
      data: parsed.data,
    })

    return Response.json(item, { status: 201 })
  } catch (error) {
    console.error('Create item error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
