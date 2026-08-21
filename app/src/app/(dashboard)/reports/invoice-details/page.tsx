export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate, formatInvoiceNumber } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { parseCurrencyParam, defaultInvoiceCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'
import StatusBadge from '@/components/ui/StatusBadge'

export const metadata: Metadata = { title: 'Invoice Details — Reports' }

export default async function InvoiceDetailsReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const clientFilter = typeof p.clientId === 'string' ? p.clientId : undefined
  const statusFilter = typeof p.status === 'string' ? p.status : undefined
  const currency = parseCurrencyParam(p) || (await defaultInvoiceCurrency())

  const where: Record<string, unknown> = {
    dateIssued: { gte: start, lte: end },
    currency,
  }
  if (clientFilter) where.clientId = clientFilter
  if (statusFilter) where.status = statusFilter

  const invoices = await prisma.invoice.findMany({
    where,
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: [{ clientId: 'asc' }, { invoiceNumber: 'asc' }],
  })

  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.total), 0)
  const totalPaid = invoices.reduce((s, i) => s + Number(i.amountPaid), 0)
  const totalDue = invoices.reduce((s, i) => s + Number(i.amountDue), 0)

  // Group by client
  const byClient = new Map<string, typeof invoices>()
  for (const inv of invoices) {
    const k = inv.clientId
    if (!byClient.has(k)) byClient.set(k, [] as unknown as typeof invoices)
    byClient.get(k)!.push(inv)
  }

  function clientName(c: { organization: string; firstName: string; lastName: string } | null) {
    if (!c) return 'No Client'
    return c.organization || `${c.firstName} ${c.lastName}`.trim()
  }

  return (
    <ReportLayout title="Invoice Details" rangeLabel={label} currentPreset={preset} currency={currency} fiscalYearEnd={company.fiscalYearEnd}>
      <div className="grid grid-cols-3 gap-6 mb-6 pb-6 border-b border-[#E1E6EB]">
        <div>
          <div className="text-xs text-[#576981] uppercase">Total Invoiced</div>
          <div className="text-2xl font-semibold text-[#001B40] mt-1">
            {formatCurrency(totalInvoiced, currency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#576981] uppercase">Amount Paid</div>
          <div className="text-2xl font-semibold text-[#006644] mt-1">
            {formatCurrency(totalPaid, currency)}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#576981] uppercase">Amount Due</div>
          <div className="text-2xl font-semibold text-[#BF2600] mt-1">
            {formatCurrency(totalDue, currency)}
          </div>
        </div>
      </div>

      {byClient.size === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No invoices found in this time period. Please adjust the range.
        </p>
      ) : (
        <div className="space-y-8">
          {Array.from(byClient.entries()).map(([clientId, invs]) => (
            <div key={clientId}>
              <h3 className="text-base font-semibold text-[#001B40] mb-3">
                {clientName(invs[0].client)}
              </h3>
              {invs.map((inv) => (
                <div key={inv.id} className="mb-5 border border-[#E1E6EB] rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-[#F5F7FA] px-4 py-2">
                    <div>
                      <span className="text-sm font-semibold text-[#0075DD]">
                        #{formatInvoiceNumber(Number(inv.invoiceNumber))}
                      </span>
                      <span className="mx-2 text-[#576981] text-sm">·</span>
                      <span className="text-sm text-[#576981]">{formatDate(inv.dateIssued)}</span>
                    </div>
                    <StatusBadge status={inv.status} />
                  </div>
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#E1E6EB]">
                        <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Description</th>
                        <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Rate</th>
                        <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Qty</th>
                        <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.lineItems.map((li) => (
                        <tr key={li.id} className="border-b border-[#E1E6EB]">
                          <td className="px-4 py-1 text-sm text-[#001B40]">
                            <div className="font-medium">{li.title}</div>
                            {li.description && (
                              <div className="text-xs text-[#576981]">{li.description}</div>
                            )}
                          </td>
                          <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                            {formatCurrency(Number(li.rate), inv.currency, { includeCode: false })}
                          </td>
                          <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                            {Number(li.quantity)}
                          </td>
                          <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                            {formatCurrency(Number(li.lineTotal), inv.currency, { includeCode: false })}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-[#F5F7FA]">
                        <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-right text-[#001B40]">
                          Total
                        </td>
                        <td className="px-4 py-1 text-sm font-semibold text-right text-[#001B40]">
                          {formatCurrency(Number(inv.total), inv.currency, { includeCode: false })}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </ReportLayout>
  )
}
