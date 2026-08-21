import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { formatCsv, formatCsvDate } from '@/lib/csv'
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
  const where = buildInvoicesWhere(sp)
  const { sortBy, sortDir } = resolveInvoiceSort(sp)

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      client: {
        select: { firstName: true, lastName: true, organization: true },
      },
    },
    orderBy: { [sortBy]: sortDir },
  })

  const headers = [
    'Invoice Number',
    'Status',
    'Client',
    'Date Issued',
    'Date Due',
    'Currency',
    'Subtotal',
    'Tax',
    'Discount',
    'Total',
    'Amount Paid',
    'Amount Due',
    'Reference',
    'Description',
  ]

  function clientName(c: { firstName: string; lastName: string; organization: string }) {
    if (c.organization) return c.organization
    return `${c.firstName} ${c.lastName}`.trim()
  }

  const rows = invoices.map((inv) => [
    inv.invoiceNumber,
    inv.status,
    clientName(inv.client),
    formatCsvDate(inv.dateIssued),
    formatCsvDate(inv.dateDue),
    inv.currency,
    Number(inv.subtotal).toFixed(2),
    Number(inv.taxTotal).toFixed(2),
    Number(inv.discount).toFixed(2),
    Number(inv.total).toFixed(2),
    Number(inv.amountPaid).toFixed(2),
    Number(inv.amountDue).toFixed(2),
    inv.reference,
    inv.description,
  ])

  const csv = formatCsv(headers, rows)
  const filename = `invoices-${new Date().toISOString().slice(0, 10)}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
