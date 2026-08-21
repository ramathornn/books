export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { formatCurrency, formatDate } from '@/lib/utils'
import { resolveReportRange, resolveCustomReportRange } from '@/lib/reportRange'
import { parseCurrencyParam, defaultGLAccountCurrency } from '@/lib/reportCurrency'
import { getCompanySettings } from '@/lib/company'
import ReportLayout from '@/components/reports/ReportLayout'
import { generalLedgerByAccount } from '@/lib/reports/generalLedger'

export const metadata: Metadata = { title: 'General Ledger — Reports' }

export default async function GeneralLedgerReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-month'
  const customRange = resolveCustomReportRange(
    typeof p.start === 'string' ? p.start : undefined,
    typeof p.end === 'string' ? p.end : undefined
  )
  const company = await getCompanySettings()
  const { start, end, label } = customRange ?? resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultGLAccountCurrency())

  const accounts = await generalLedgerByAccount(start, end, currency)

  return (
    <ReportLayout
      title="General Ledger"
      rangeLabel={label}
      currentPreset={preset}
      currency={currency}
      updatedBadge
      tabs={[
        { value: 'default', label: 'This Month' },
        { value: 'last-quarter', label: 'Last Quarter' },
        { value: 'last-year', label: 'Last Year' },
      ]}
      fiscalYearEnd={company.fiscalYearEnd}
      hasExport
    >
      {accounts.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">No active accounts found. Please adjust the range.</p>
      ) : (
        <div className="space-y-6">
          {accounts.map(({ account, rows }) => (
            <div key={account.id}>
              <h3 className="text-base font-semibold text-[#001B40] bg-[#F5F7FA] px-4 py-2 rounded-t border border-[#E1E6EB]">
                {account.accountNumber} — {account.accountName}
              </h3>
              <table className="w-full border-x border-b border-[#E1E6EB]">
                <thead>
                  <tr className="border-b border-[#E1E6EB]">
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Date</th>
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Entry #</th>
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Note</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Debit</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-[#E1E6EB]">
                      <td className="px-4 py-1 text-sm text-[#001B40]">{formatDate(r.date)}</td>
                      <td className="px-4 py-1 text-sm text-[#0075DD]">{r.entryNumber}</td>
                      <td className="px-4 py-1 text-sm text-[#576981]">{r.description}</td>
                      <td className="px-4 py-1 text-sm text-right">
                        {r.debit ? formatCurrency(r.debit, currency, { includeCode: false }) : '—'}
                      </td>
                      <td className="px-4 py-1 text-sm text-right">
                        {r.credit ? formatCurrency(r.credit, currency, { includeCode: false }) : '—'}
                      </td>
                      <td className="px-4 py-1 text-sm text-right font-semibold">
                        {formatCurrency(r.balance, currency, { includeCode: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-[#576981] italic">
        Recent changes may take up to 1.5 minutes to appear in this report.
      </p>
    </ReportLayout>
  )
}
