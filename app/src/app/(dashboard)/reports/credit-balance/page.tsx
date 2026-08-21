export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { parseCurrencyParam, defaultInvoiceCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Credit Balance — Reports' }

export default async function CreditBalanceReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const currency = parseCurrencyParam(p) || (await defaultInvoiceCurrency())

  // Credit balance: payments exceeding invoice totals. Compute per client
  // restricted to invoices/payments in the selected currency.
  const clients = await prisma.client.findMany({
    include: {
      invoices: {
        where: { currency },
        select: { total: true, amountPaid: true, currency: true },
      },
      payments: {
        where: { currency },
        select: { amount: true, currency: true },
      },
    },
  })

  const rows = clients
    .map((c) => {
      const invoiced = c.invoices.reduce((s, i) => s + Number(i.total), 0)
      const paid = c.payments.reduce((s, p) => s + Number(p.amount), 0)
      const creditIssued = 0 // We don't have credit notes in schema — placeholder
      const creditApplied = 0
      const creditBalance = Math.max(0, paid - invoiced)
      return {
        name: c.organization || `${c.firstName} ${c.lastName}`.trim(),
        balanceForward: 0,
        creditIssued,
        creditApplied,
        creditBalance,
        currency,
      }
    })
    .filter((r) => r.creditBalance > 0)

  const total = rows.reduce((s, r) => s + r.creditBalance, 0)

  return (
    <ReportLayout title="Credit Balance" rangeLabel="Summary of Credits" currentPreset="today" currency={currency}>
      {rows.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">No clients with credit balances.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Client Name</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Balance Forward</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit Issued</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit Applied</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[#E1E6EB]">
                <td className="px-4 py-1 text-sm text-[#001B40]">{r.name}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.balanceForward, r.currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.creditIssued, r.currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right">{formatCurrency(r.creditApplied, r.currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right font-semibold">
                  {formatCurrency(r.creditBalance, r.currency, { includeCode: false })}
                </td>
              </tr>
            ))}
            <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
              <td colSpan={4} className="px-4 py-2 text-sm font-semibold">Total</td>
              <td className="px-4 py-1 text-sm text-right font-bold">{formatCurrency(total, currency)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </ReportLayout>
  )
}
