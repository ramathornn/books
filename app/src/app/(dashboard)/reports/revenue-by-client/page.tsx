export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { priorYearRange } from '@/lib/priorYearRange'
import { parseCurrencyParam, defaultInvoiceCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Revenue by Client — Reports' }

async function computeByClient(start: Date, end: Date, currency: string) {
  const invoices = await prisma.invoice.findMany({
    where: { dateIssued: { gte: start, lte: end }, currency },
    include: { client: true },
  })
  const byClient = new Map<string, { name: string; revenue: number }>()
  for (const i of invoices) {
    const k = i.clientId
    const name = i.client?.organization || `${i.client?.firstName} ${i.client?.lastName}`.trim()
    if (!byClient.has(k)) byClient.set(k, { name, revenue: 0 })
    byClient.get(k)!.revenue += Number(i.total)
  }
  return byClient
}

export default async function RevenueByClientReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const tab = typeof p.tab === 'string' ? p.tab : 'default'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultInvoiceCurrency())

  const byClient = await computeByClient(start, end, currency)
  const rows = Array.from(byClient.entries())
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
  const total = rows.reduce((s, r) => s + r.revenue, 0)

  const tabs = [
    { value: 'default', label: 'This Year' },
    { value: 'last-quarter', label: 'Last Quarter' },
    { value: 'vs-last-year', label: 'This Year vs Last Year' },
    { value: 'percent', label: '% of Income' },
  ]

  if (tab === 'vs-last-year') {
    const prior = priorYearRange({ start, end })
    const priorByClient = await computeByClient(prior.start, prior.end, currency)

    const keys = new Set<string>([...byClient.keys(), ...priorByClient.keys()])
    const mergedRows = Array.from(keys).map((id) => {
      const cur = byClient.get(id)
      const prv = priorByClient.get(id)
      return {
        id,
        name: cur?.name || prv?.name || '—',
        current: cur?.revenue || 0,
        prior: prv?.revenue || 0,
      }
    }).sort((a, b) => b.current - a.current)

    const totalPrior = Array.from(priorByClient.values()).reduce((s, r) => s + r.revenue, 0)

    return (
      <ReportLayout
        title="Revenue by Client"
        rangeLabel={label}
        currentPreset={preset}
        currency={currency}
        updatedBadge
        tabs={tabs}
        fiscalYearEnd={company.fiscalYearEnd}
      >
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Client</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Current</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Prior Year</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Change ($)</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Change (%)</th>
            </tr>
          </thead>
          <tbody>
            {mergedRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-sm text-[#576981]">No revenue in these periods.</td>
              </tr>
            ) : (
              mergedRows.map((r) => {
                const delta = r.current - r.prior
                const pct = r.prior === 0 ? (r.current === 0 ? 0 : null) : (delta / Math.abs(r.prior)) * 100
                return (
                  <tr key={r.id} className="border-b border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#001B40]">{r.name || '—'}</td>
                    <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">{formatCurrency(r.current, currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(r.prior, currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(delta, currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#576981]">{pct === null ? '—' : `${pct.toFixed(1)}%`}</td>
                  </tr>
                )
              })
            )}
            <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(total, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(totalPrior, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(total - totalPrior, currency)}</td>
              <td className="px-4 py-1 text-sm text-right text-[#576981]">
                {totalPrior === 0 ? '—' : `${(((total - totalPrior) / Math.abs(totalPrior)) * 100).toFixed(1)}%`}
              </td>
            </tr>
          </tbody>
        </table>
      </ReportLayout>
    )
  }

  // `percent` tab uses the same layout as default (which already shows a % of Total column),
  // but explicitly labelled "% of Revenue" to match the tab.
  const percentMode = tab === 'percent'

  return (
    <ReportLayout
      title="Revenue by Client"
      rangeLabel={label}
      currentPreset={preset}
      currency={currency}
      updatedBadge
      tabs={tabs}
      fiscalYearEnd={company.fiscalYearEnd}
    >
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E1E6EB]">
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Client</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Total</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981] w-28">
              {percentMode ? '% of Revenue' : '% of Total'}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-10 text-center text-sm text-[#576981]">No revenue in this period.</td>
            </tr>
          ) : (
            rows.map((r) => {
              const pct = total > 0 ? (r.revenue / total) * 100 : 0
              return (
                <tr key={r.id} className="border-b border-[#E1E6EB]">
                  <td className="px-4 py-1 text-sm text-[#001B40]">{r.name || '—'}</td>
                  <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">
                    {formatCurrency(r.revenue, currency, { includeCode: false })}
                  </td>
                  <td className="px-4 py-1 text-sm text-right text-[#576981]">{pct.toFixed(1)}%</td>
                </tr>
              )
            })
          )}
          <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
            <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total</td>
            <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">
              {formatCurrency(total, currency)}
            </td>
            <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">100%</td>
          </tr>
        </tbody>
      </table>
    </ReportLayout>
  )
}
