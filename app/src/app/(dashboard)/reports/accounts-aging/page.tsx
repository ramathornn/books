export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDateLong } from '@/lib/utils'
import { parseCurrencyParam, defaultInvoiceCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Accounts Aging — Reports' }

function clientName(c: { organization: string; firstName: string; lastName: string } | null) {
  if (!c) return 'No Client'
  return c.organization || `${c.firstName} ${c.lastName}`.trim()
}

export default async function AccountsAgingReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const currency = parseCurrencyParam(p) || (await defaultInvoiceCurrency())
  const now = new Date()
  const invoices = await prisma.invoice.findMany({
    where: { status: { notIn: ['paid', 'draft', 'bad_debt'] }, currency },
    include: { client: true },
  })


  const byClient = new Map<string, { name: string; b0: number; b30: number; b60: number; b90: number; total: number }>()

  for (const inv of invoices) {
    const due = new Date(inv.dateDue)
    const daysOverdue = Math.max(0, Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24)))
    const amount = Number(inv.amountDue)
    const k = inv.clientId
    if (!byClient.has(k)) {
      byClient.set(k, { name: clientName(inv.client), b0: 0, b30: 0, b60: 0, b90: 0, total: 0 })
    }
    const r = byClient.get(k)!
    if (daysOverdue <= 30) r.b0 += amount
    else if (daysOverdue <= 60) r.b30 += amount
    else if (daysOverdue <= 90) r.b60 += amount
    else r.b90 += amount
    r.total += amount
  }

  const rows = Array.from(byClient.values()).filter((r) => r.total > 0).sort((a, b) => b.total - a.total)
  const totals = rows.reduce(
    (a, r) => ({
      b0: a.b0 + r.b0,
      b30: a.b30 + r.b30,
      b60: a.b60 + r.b60,
      b90: a.b90 + r.b90,
      total: a.total + r.total,
    }),
    { b0: 0, b30: 0, b60: 0, b90: 0, total: 0 }
  )

  return (
    <ReportLayout
      title="Accounts Aging"
      rangeLabel={`Amounts Outstanding (${currency}) — As of ${formatDateLong(now)}`}
      currentPreset="today"
      currency={currency}
    >
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E1E6EB]">
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Client</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">0–30 Days</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">31–60 Days</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">61–90 Days</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">90+ Days</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="py-10 text-center text-sm text-[#576981]">
                No outstanding invoices.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i} className="border-b border-[#E1E6EB]">
                <td className="px-4 py-1 text-sm text-[#001B40]">{r.name}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.b0, currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.b30, currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.b60, currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.b90, currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right font-semibold">
                  {formatCurrency(r.total, currency, { includeCode: false })}
                </td>
              </tr>
            ))
          )}
          <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
            <td className="px-4 py-1 text-sm font-semibold">Total</td>
            <td className="px-4 py-1 text-sm text-right font-semibold">{formatCurrency(totals.b0, currency, { includeCode: false })}</td>
            <td className="px-4 py-1 text-sm text-right font-semibold">{formatCurrency(totals.b30, currency, { includeCode: false })}</td>
            <td className="px-4 py-1 text-sm text-right font-semibold">{formatCurrency(totals.b60, currency, { includeCode: false })}</td>
            <td className="px-4 py-1 text-sm text-right font-semibold">{formatCurrency(totals.b90, currency, { includeCode: false })}</td>
            <td className="px-4 py-1 text-sm text-right font-bold">{formatCurrency(totals.total, currency)}</td>
          </tr>
        </tbody>
      </table>
    </ReportLayout>
  )
}
