import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import {
  buildPaymentsWhere,
  resolvePaymentSort,
} from '@/lib/listFilters/payments'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp = request.nextUrl.searchParams
  const page = Math.max(1, Number(sp.get('page')) || 1)
  const PER_PAGE_RAW = Number(sp.get('perPage')) || 40
  const PER_PAGE = [25, 40, 50, 100].includes(PER_PAGE_RAW) ? PER_PAGE_RAW : 40

  const { sortBy, sortDir } = resolvePaymentSort(sp)
  const where = buildPaymentsWhere(sp)

  const totalCount = await prisma.payment.count({ where })

  const payments = await prisma.payment.findMany({
    where,
    include: {
      client: true,
      invoice: { select: { id: true, invoiceNumber: true } },
    },
    orderBy: { [sortBy]: sortDir },
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  })

  const rows = payments.map((p) => ({
    id: p.id,
    paymentDate: p.paymentDate.toISOString(),
    paymentMethod: p.paymentMethod,
    amount: String(p.amount),
    currency: p.currency,
    notes: p.notes,
    status: p.status,
    invoiceId: p.invoiceId,
    client: {
      firstName: p.client.firstName,
      lastName: p.client.lastName,
      organization: p.client.organization,
    },
    invoice: p.invoice
      ? { id: p.invoice.id, invoiceNumber: p.invoice.invoiceNumber }
      : null,
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
