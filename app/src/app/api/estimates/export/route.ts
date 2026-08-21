import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { formatCsv, formatCsvDate } from '@/lib/csv'
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
  const where = buildEstimatesWhere(sp)
  const { orderBy } = resolveEstimateSort(sp)

  const estimates = await prisma.estimate.findMany({
    where,
    include: {
      client: {
        select: { firstName: true, lastName: true, organization: true },
      },
    },
    orderBy,
  })

  const headers = [
    'Estimate Number',
    'Status',
    'Client',
    'Date Issued',
    'Currency',
    'Subtotal',
    'Tax',
    'Total',
    'Description',
  ]

  function clientName(c: { firstName: string; lastName: string; organization: string }) {
    if (c.organization) return c.organization
    return `${c.firstName} ${c.lastName}`.trim()
  }

  const rows = estimates.map((e) => [
    e.estimateNumber,
    e.status,
    clientName(e.client),
    formatCsvDate(e.dateIssued),
    e.currency,
    Number(e.subtotal).toFixed(2),
    Number(e.taxTotal).toFixed(2),
    Number(e.total).toFixed(2),
    e.description,
  ])

  const csv = formatCsv(headers, rows)
  const filename = `estimates-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
