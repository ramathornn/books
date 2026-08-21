export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate, formatInvoiceNumber } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { parseCurrencyParam, defaultInvoiceCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Item Sales — Reports' }

export default async function ItemSalesReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultInvoiceCurrency())

  const invoices = await prisma.invoice.findMany({
    where: { dateIssued: { gte: start, lte: end }, currency },
    include: { client: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { dateIssued: 'asc' },
  })

  // Group line items by item title
  const byItem = new Map<
    string,
    Array<{
      invoiceId: string
      invoiceNumber: string
      dateIssued: Date
      clientName: string
      rate: number
      quantity: number
      lineTotal: number
      currency: string
    }>
  >()
  let totalUnits = 0
  let totalSales = 0

  for (const inv of invoices) {
    for (const li of inv.lineItems) {
      const name = li.title || '(Untitled)'
      if (!byItem.has(name)) byItem.set(name, [])
      byItem.get(name)!.push({
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        dateIssued: inv.dateIssued,
        clientName: inv.client?.organization ||
          `${inv.client?.firstName || ''} ${inv.client?.lastName || ''}`.trim() || '—',
        rate: Number(li.rate),
        quantity: Number(li.quantity),
        lineTotal: Number(li.lineTotal),
        currency: inv.currency,
      })
      totalUnits += Number(li.quantity)
      totalSales += Number(li.lineTotal)
    }
  }

  return (
    <ReportLayout title="Item Sales" rangeLabel={label} currentPreset={preset} currency={currency} fiscalYearEnd={company.fiscalYearEnd}>
      <div className="grid grid-cols-2 gap-6 mb-6 pb-6 border-b border-[#E1E6EB]">
        <div>
          <div className="text-xs text-[#576981] uppercase">Total Units</div>
          <div className="text-2xl font-semibold text-[#001B40] mt-1">{totalUnits}</div>
        </div>
        <div>
          <div className="text-xs text-[#576981] uppercase">Total Item Sales ({currency})</div>
          <div className="text-2xl font-semibold text-[#001B40] mt-1">
            {formatCurrency(totalSales, currency)}
          </div>
        </div>
      </div>

      {byItem.size === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No item sales found in this period.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(byItem.entries()).map(([name, rows]) => (
            <div key={name}>
              <h3 className="text-base font-semibold text-[#001B40] mb-2">{name}</h3>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#E1E6EB]">
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Client</th>
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Invoice</th>
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Date</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Rate</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Qty</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={`${r.invoiceId}-${i}`} className="border-b border-[#E1E6EB]">
                      <td className="px-4 py-1 text-sm text-[#001B40]">{r.clientName}</td>
                      <td className="px-4 py-1 text-sm">
                        <Link href={`/invoices/${r.invoiceId}`} className="text-[#0075DD] hover:underline">
                          #{formatInvoiceNumber(Number(r.invoiceNumber))}
                        </Link>
                      </td>
                      <td className="px-4 py-1 text-sm text-[#576981]">{formatDate(r.dateIssued)}</td>
                      <td className="px-4 py-1 text-sm text-right">
                        {formatCurrency(r.rate, r.currency, { includeCode: false })}
                      </td>
                      <td className="px-4 py-1 text-sm text-right">{r.quantity}</td>
                      <td className="px-4 py-1 text-sm text-right font-semibold">
                        {formatCurrency(r.lineTotal, r.currency, { includeCode: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </ReportLayout>
  )
}
