export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { parseCurrencyParam, defaultInvoiceCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Sales Tax Summary — Reports' }

export default async function SalesTaxSummaryReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultInvoiceCurrency())

  // Only invoices whose accrual has been posted to the ledger (journalEntryId set)
  // contribute recognized tax. This keeps the summary reconciled with the GST/HST
  // Detail report, which reads the posted journal entries on GST Payable (2315).
  // Unposted invoices (drafts, or any status that never accrued) are excluded.
  const invoices = await prisma.invoice.findMany({
    where: {
      dateIssued: { gte: start, lte: end },
      currency,
      journalEntryId: { not: null },
    },
    include: { lineItems: true },
  })

  const totalBilled = invoices.reduce((s, i) => s + Number(i.subtotal), 0)

  // Aggregate by tax code. Parse codes like "GST:5" or bare "GST" (5% fallback —
  // matches how invoice.taxTotal was computed at save time and posted to the ledger).
  const taxMap = new Map<string, { name: string; rate: number; taxable: number; tax: number }>()
  for (const inv of invoices) {
    for (const li of inv.lineItems) {
      for (const code of li.taxCodes) {
        const [name, rateStr] = code.split(':')
        const rate = parseFloat(rateStr || '0') || (name.toUpperCase().includes('GST') ? 5 : 0)
        if (!rate) continue
        const key = `${name.toUpperCase()}:${rate}`
        if (!taxMap.has(key)) {
          taxMap.set(key, { name: `${name.toUpperCase()} (${rate}%)`, rate, taxable: 0, tax: 0 })
        }
        const t = taxMap.get(key)!
        t.taxable += Number(li.lineTotal)
        t.tax += Number(li.lineTotal) * (rate / 100)
      }
    }
  }
  const rows = Array.from(taxMap.values())
  const totalTax = rows.reduce((s, r) => s + r.tax, 0)

  return (
    <ReportLayout
      title="Sales Tax Summary"
      rangeLabel={`Total Billed: ${formatCurrency(totalBilled, currency)} — ${label}`}
      currentPreset={preset}
      currency={currency}
      fiscalYearEnd={company.fiscalYearEnd}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No tax information found. Please adjust the range.
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Tax Name</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Taxable Amount</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Taxes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-[#E1E6EB]">
                <td className="px-4 py-1 text-sm text-[#001B40]">{r.name}</td>
                <td className="px-4 py-1 text-sm text-right">
                  {formatCurrency(r.taxable, currency, { includeCode: false })}
                </td>
                <td className="px-4 py-1 text-sm text-right font-semibold">
                  {formatCurrency(r.tax, currency, { includeCode: false })}
                </td>
              </tr>
            ))}
            <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
              <td colSpan={2} className="px-4 py-2 text-sm font-semibold">Total Tax</td>
              <td className="px-4 py-1 text-sm text-right font-bold">{formatCurrency(totalTax, currency)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </ReportLayout>
  )
}
