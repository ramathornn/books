export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate, formatInvoiceNumber } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { parseCurrencyParam, defaultPaymentCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Payments Collected — Reports' }

export default async function PaymentsCollectedReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-month'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultPaymentCurrency())

  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: start, lte: end }, currency },
    include: { client: true, invoice: true },
    orderBy: { paymentDate: 'desc' },
  })

  const total = payments.reduce((s, pm) => s + Number(pm.amount), 0)

  return (
    <ReportLayout
      title="Payments Collected"
      rangeLabel={`All Methods of Payment — ${label}`}
      currentPreset={preset}
      currency={currency}
      fiscalYearEnd={company.fiscalYearEnd}
    >
      {payments.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No payments found. Please adjust the range.
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Date</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Client</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Invoice</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Method</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((pm) => (
              <tr key={pm.id} className="border-b border-[#E1E6EB]">
                <td className="px-4 py-1 text-sm text-[#001B40]">{formatDate(pm.paymentDate)}</td>
                <td className="px-4 py-1 text-sm text-[#001B40]">
                  {pm.client?.organization || `${pm.client?.firstName} ${pm.client?.lastName}`.trim()}
                </td>
                <td className="px-4 py-1 text-sm">
                  {pm.invoice && (
                    <Link href={`/invoices/${pm.invoice.id}`} className="text-[#0075DD] hover:underline">
                      #{formatInvoiceNumber(Number(pm.invoice.invoiceNumber))}
                    </Link>
                  )}
                </td>
                <td className="px-4 py-1 text-sm text-[#576981] capitalize">{pm.paymentMethod}</td>
                <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">
                  {formatCurrency(Number(pm.amount), pm.currency, { includeCode: false })}
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
