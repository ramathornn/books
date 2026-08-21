import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  buildEstimatesWhere,
  resolveEstimateSort,
} from '@/lib/listFilters/estimates'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const PER_PAGE_RAW = Number(sp.get('perPage')) || 30
  const PER_PAGE = [25, 30, 50, 100].includes(PER_PAGE_RAW) ? PER_PAGE_RAW : 30

  const where = buildEstimatesWhere(sp)
  const { orderBy, sortBy, sortDir } = resolveEstimateSort(sp)

  const totalCount = await prisma.estimate.count({ where })

  const estimates = await prisma.estimate.findMany({
    where,
    include: {
      client: true,
      lineItems: { take: 1, select: { description: true } },
    },
    orderBy,
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  })

  const rows = estimates.map((e) => ({
    id: e.id,
    estimateNumber: e.estimateNumber,
    status: e.status,
    currency: e.currency,
    dateIssued: e.dateIssued,
    description: e.lineItems[0]?.description || e.description || '',
    total: Number(e.total),
    client: {
      firstName: e.client.firstName,
      lastName: e.client.lastName,
      organization: e.client.organization,
    },
  }))

  return Response.json({
    rows,
    totalCount,
    totalPages: Math.ceil(totalCount / PER_PAGE),
    perPage: PER_PAGE,
    page,
    sortBy,
    sortDir,
  })
}
