import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { formatCsv, formatCsvDate } from '@/lib/csv'
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
  const where = buildPaymentsWhere(sp)
  const { sortBy, sortDir } = resolvePaymentSort(sp)

  const payments = await prisma.payment.findMany({
    where,
    include: {
      client: true,
      invoice: { select: { invoiceNumber: true } },
    },
    orderBy: { [sortBy]: sortDir },
  })

  const headers = [
    'Payment Date',
    'Invoice Number',
    'Client',
    'Payment Method',
    'Source',
    'Currency',
    'Amount',
    'Notes',
  ]

  function clientName(c: { firstName: string; lastName: string; organization: string }) {
    if (c.organization) return c.organization
    return `${c.firstName} ${c.lastName}`.trim()
  }

  const rows = payments.map((p) => [
    formatCsvDate(p.paymentDate),
    p.invoice?.invoiceNumber ?? '',
    clientName(p.client),
    p.paymentMethod,
    p.source,
    p.currency,
    Number(p.amount).toFixed(2),
    p.notes,
  ])

  const csv = formatCsv(headers, rows)
  const filename = `payments-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
