export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { formatCurrency, formatDate, formatDateLong } from '@/lib/utils'
import { resolveReportRange, resolveCustomReportRange } from '@/lib/reportRange'
import ReportLayout from '@/components/reports/ReportLayout'
import { getCompanySettings } from '@/lib/company'
import {
  computeCashFlowFromGL,
  listCashTransactions,
  type CashFlowRow,
} from '@/lib/reports/cashFlow'

export const metadata: Metadata = { title: 'Cash Flow — Reports' }

const CURRENCY = 'CAD' // GL-derived statement: accrual, indirect, CAD (same stance as accrual P&L)

const tabs = [
  { value: 'default', label: 'Overview' },
  { value: 'detail', label: 'Cash Transactions' },
]

/** Section header row (Balance Sheet idiom). */
function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="text-base font-semibold text-[#001B40] bg-[#F5F7FA] px-4 py-2 rounded-t border border-[#E1E6EB]">
      {title}
    </h3>
  )
}

/** One account row: name + muted account number, amount right-aligned. */
function AccountRow({ row }: { row: CashFlowRow }) {
  return (
    <tr className="border-t border-[#E1E6EB]">
      <td className="px-4 py-1 text-sm text-[#001B40] pl-8">
        {row.accountName}
        <span className="text-xs text-[#576981] ml-2">{row.accountNumber}</span>
      </td>
      <td className={`px-4 py-1 text-sm text-right ${row.amount < 0 ? 'text-[#BF2600]' : 'text-[#001B40]'}`}>
        {formatCurrency(row.amount, CURRENCY, { includeCode: false })}
      </td>
    </tr>
  )
}

/** A labelled row with no account number (Net income, subtotals). */
function LabelRow({
  label,
  amount,
  subtotal = false,
  subgroup = false,
}: {
  label: string
  amount?: number
  subtotal?: boolean
  subgroup?: boolean
}) {
  if (subgroup) {
    return (
      <tr>
        <td colSpan={2} className="px-4 py-1 text-xs font-semibold text-[#576981] uppercase">
          {label}
        </td>
      </tr>
    )
  }
  if (subtotal) {
    return (
      <tr className="border-t-2 border-[#001B40] bg-[#F5F7FA]">
        <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">{label}</td>
        <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">
          {formatCurrency(amount ?? 0, CURRENCY)}
        </td>
      </tr>
    )
  }
  return (
    <tr className="border-t border-[#E1E6EB]">
      <td className="px-4 py-1 text-sm text-[#001B40] pl-8">{label}</td>
      <td className={`px-4 py-1 text-sm text-right ${(amount ?? 0) < 0 ? 'text-[#BF2600]' : 'text-[#001B40]'}`}>
        {formatCurrency(amount ?? 0, CURRENCY, { includeCode: false })}
      </td>
    </tr>
  )
}

export default async function CashFlowReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const tab = typeof p.tab === 'string' ? p.tab : 'default'
  const company = await getCompanySettings()
  const range =
    resolveCustomReportRange(
      typeof p.start === 'string' ? p.start : undefined,
      typeof p.end === 'string' ? p.end : undefined
    ) ?? resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const { start, end, label } = range

  // Detail tab: cash JE lines, month-grouped (structure carried over from the stub).
  if (tab === 'detail') {
    const rows = await listCashTransactions(start, end)

    const byMonth = new Map<
      string,
      { label: string; rows: typeof rows; inflow: number; outflow: number }
    >()
    for (const r of rows) {
      // UTC getters: date-only entry dates are stored at UTC midnight, so local
      // getters on a non-UTC box would bucket month-first entries into the prior month.
      const key = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, '0')}`
      if (!byMonth.has(key)) {
        byMonth.set(key, {
          label: r.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
          rows: [],
          inflow: 0,
          outflow: 0,
        })
      }
      const bucket = byMonth.get(key)!
      bucket.rows.push(r)
      bucket.inflow += r.inflow
      bucket.outflow += r.outflow
    }

    const totalInflow = rows.reduce((s, r) => s + r.inflow, 0)
    const totalOutflow = rows.reduce((s, r) => s + r.outflow, 0)

    return (
      <ReportLayout
        title="Cash Flow"
        rangeLabel={label}
        currentPreset={preset}
        updatedBadge
        companyName={company.legalName || company.name}
        fiscalYearEnd={company.fiscalYearEnd}
        hasExport
        tabs={tabs}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-[#576981] text-center py-8">No cash activity in this period.</p>
        ) : (
          <div className="space-y-6">
            {Array.from(byMonth.entries()).map(([key, m]) => (
              <div key={key}>
                <h3 className="text-base font-semibold text-[#001B40] bg-[#F5F7FA] px-4 py-2 rounded-t border border-[#E1E6EB]">
                  {m.label}
                </h3>
                <table className="w-full border-x border-b border-[#E1E6EB]">
                  <thead>
                    <tr className="border-b border-[#E1E6EB]">
                      <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-32">Date</th>
                      <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-28">Entry</th>
                      <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Description</th>
                      <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account</th>
                      <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981] w-32">Inflow</th>
                      <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981] w-32">Outflow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {m.rows.map((r, i) => (
                      <tr key={i} className="border-b border-[#E1E6EB]">
                        <td className="px-4 py-1 text-sm text-[#001B40]">{formatDate(r.date)}</td>
                        <td className="px-4 py-1 text-sm text-[#576981]">{r.entryNumber}</td>
                        <td className="px-4 py-1 text-sm text-[#001B40]">{r.description}</td>
                        <td className="px-4 py-1 text-sm text-[#001B40]">{r.accountName}</td>
                        <td className="px-4 py-1 text-sm text-right text-[#006644]">
                          {r.inflow ? formatCurrency(r.inflow, CURRENCY, { includeCode: false }) : '—'}
                        </td>
                        <td className="px-4 py-1 text-sm text-right text-[#BF2600]">
                          {r.outflow ? formatCurrency(r.outflow, CURRENCY, { includeCode: false }) : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-[#F5F7FA]">
                      <td colSpan={4} className="px-4 py-2 text-sm font-semibold text-[#001B40]">Subtotal</td>
                      <td className="px-4 py-1 text-sm text-right font-semibold text-[#006644]">{formatCurrency(m.inflow, CURRENCY)}</td>
                      <td className="px-4 py-1 text-sm text-right font-semibold text-[#BF2600]">{formatCurrency(m.outflow, CURRENCY)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ))}
            <table className="w-full border-t-2 border-[#001B40]">
              <tbody>
                <tr>
                  <td className="px-4 py-1 text-sm font-bold text-[#001B40]">Totals</td>
                  <td className="px-4 py-1 text-sm text-right font-bold text-[#006644] w-32">{formatCurrency(totalInflow, CURRENCY)}</td>
                  <td className="px-4 py-1 text-sm text-right font-bold text-[#BF2600] w-32">{formatCurrency(totalOutflow, CURRENCY)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </ReportLayout>
    )
  }

  // Overview tab: the statement of cash flows itself.
  const s = await computeCashFlowFromGL(start, end)

  return (
    <ReportLayout
      title="Cash Flow"
      rangeLabel={label}
      currentPreset={preset}
      updatedBadge
      companyName={company.legalName || company.name}
      fiscalYearEnd={company.fiscalYearEnd}
      hasExport
      tabs={tabs}
    >
      {/* Operating */}
      <div className="mb-6">
        <SectionHeader title="Operating Activities" />
        <table className="w-full border-x border-b border-[#E1E6EB]">
          <tbody>
            <LabelRow label="Net income" amount={s.netIncome} />
            {s.depreciationRows.length > 0 && (
              <>
                <LabelRow label="Adjustments for non-cash items" subgroup />
                {s.depreciationRows.map((r) => (
                  <AccountRow key={r.accountId} row={r} />
                ))}
              </>
            )}
            {s.operatingRows.length > 0 && (
              <>
                <LabelRow label="Changes in operating assets and liabilities" subgroup />
                {s.operatingRows.map((r) => (
                  <AccountRow key={r.accountId} row={r} />
                ))}
              </>
            )}
            <LabelRow label="Net cash provided by (used in) operating activities" amount={s.operatingTotal} subtotal />
          </tbody>
        </table>
      </div>

      {/* Investing — always render for a stable statement shape */}
      <div className="mb-6">
        <SectionHeader title="Investing Activities" />
        <table className="w-full border-x border-b border-[#E1E6EB]">
          <tbody>
            {s.investingRows.map((r) => (
              <AccountRow key={r.accountId} row={r} />
            ))}
            <LabelRow label="Net cash provided by (used in) investing activities" amount={s.investingTotal} subtotal />
          </tbody>
        </table>
      </div>

      {/* Financing */}
      <div className="mb-6">
        <SectionHeader title="Financing Activities" />
        <table className="w-full border-x border-b border-[#E1E6EB]">
          <tbody>
            {s.financingRows.map((r) => (
              <AccountRow key={r.accountId} row={r} />
            ))}
            <LabelRow label="Net cash provided by (used in) financing activities" amount={s.financingTotal} subtotal />
          </tbody>
        </table>
      </div>

      {/* Footer reconciliation */}
      <div className="mt-6 pt-4 border-t-2 border-[#001B40]">
        <div className="flex justify-between text-sm">
          <span className="font-bold text-[#001B40]">Net increase (decrease) in cash</span>
          <span className="font-bold text-[#001B40]">{formatCurrency(s.netCashChange, CURRENCY)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-[#576981]">Cash at beginning of period ({formatDateLong(start)})</span>
          <span className="text-[#001B40]">{formatCurrency(s.cashAtStart, CURRENCY)}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="font-semibold text-[#001B40]">Cash at end of period ({formatDateLong(end)})</span>
          <span className="font-bold text-[#001B40]">{formatCurrency(s.cashAtEnd, CURRENCY)}</span>
        </div>
        {Math.abs(s.discrepancy) > 0.01 && (
          <p className="mt-2 text-xs text-[#BF2600]">
            ⚠ This statement does not tie to the change in cash by {formatCurrency(s.discrepancy, CURRENCY)}. Check for
            opening balances dated inside the period.
          </p>
        )}
      </div>
    </ReportLayout>
  )
}
