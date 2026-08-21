import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  buildInvoicesWhere,
  resolveInvoiceSort,
} from '@/lib/listFilters/invoices'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const PER_PAGE_RAW = Number(sp.get('perPage')) || 50
  const PER_PAGE = [25, 40, 50, 100].includes(PER_PAGE_RAW) ? PER_PAGE_RAW : 50

  const { sortBy, sortDir } = resolveInvoiceSort(sp)
  const where = buildInvoicesWhere(sp)
  // Accountant sessions never see drafts (unsent working documents).
  if (session.user.role === 'accountant') {
    where.AND = [...((where.AND as unknown[] | undefined) ?? []), { status: { not: 'draft' } }]
  }

  const totalCount = await prisma.invoice.count({ where })

  const [invoices, totalsByCurrency] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        client: {
          select: { firstName: true, lastName: true, organization: true },
        },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { description: true, title: true },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          take: 1,
          select: { paymentDate: true },
        },
      },
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
    }),
    prisma.invoice.groupBy({
      by: ['currency'],
      where,
      _sum: { total: true },
    }),
  ])

  const totals: [string, number][] = totalsByCurrency
    .map((r) => [r.currency, Number(r._sum.total || 0)] as [string, number])
    .filter(([, amt]) => amt !== 0)
    .sort((a, b) => b[1] - a[1])

  const rows = invoices.map((inv) => {
    const first = inv.lineItems[0]
    const lineDesc = first ? first.description || first.title || '' : ''
    return {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      status: inv.status,
      currency: inv.currency,
      dateIssued: inv.dateIssued,
      dateDue: inv.dateDue,
      description: lineDesc,
      total: Number(inv.total),
      amountDue: Number(inv.amountDue),
      amountPaid: Number(inv.amountPaid),
      paidDate: inv.payments[0]?.paymentDate ?? null,
      onlinePaymentsEnabled: inv.onlinePaymentsEnabled,
      client: inv.client,
    }
  })

  return Response.json({
    rows,
    totalCount,
    totalPages: Math.ceil(totalCount / PER_PAGE),
    perPage: PER_PAGE,
    page,
    sortBy,
    sortDir,
    totals,
  })
}
