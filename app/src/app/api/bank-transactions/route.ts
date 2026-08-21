import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const accountId = sp.get('accountId')
  const status = sp.get('status') // pending | posted | excluded
  const search = sp.get('search')
  const page = Math.max(parseInt(sp.get('page') || '1', 10), 1)
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200)

  const where: Record<string, unknown> = {}
  if (accountId) where.bankAccountId = accountId
  if (status) where.status = status
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { memo: { contains: search, mode: 'insensitive' } },
      { payee: { contains: search, mode: 'insensitive' } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: { transactionDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.bankTransaction.count({ where }),
  ])

  // Status counts for the tabs
  const counts = accountId
    ? await prisma.bankTransaction.groupBy({
        by: ['status'],
        where: { bankAccountId: accountId },
        _count: { _all: true },
      })
    : []

  return Response.json({
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    counts: counts.reduce(
      (acc, c) => ({ ...acc, [c.status]: c._count._all }),
      { pending: 0, posted: 0, excluded: 0 }
    ),
  })
}
