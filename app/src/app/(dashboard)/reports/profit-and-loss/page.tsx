export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { formatCurrency } from '@/lib/utils'
import { resolveReportRange, resolveCustomReportRange } from '@/lib/reportRange'
import { priorYearRange } from '@/lib/priorYearRange'
import { parseCurrencyParam } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'
import PeriodPLTable from '@/components/reports/PeriodPLTable'
import { getCompanySettings } from '@/lib/company'
import { isCalendarFiscalYear } from '@/lib/fiscalYear'
import {
  computePL,
  computeMonthlyPL,
  computeQuarterlyPL,
  computeFiscalQuarterlyPL,
} from '@/lib/reports/profitAndLoss'

export const metadata: Metadata = { title: 'Profit and Loss — Reports' }

// The general ledger is maintained in CAD, so the GL-based P&L is always CAD.
const GL_CURRENCY = 'CAD'

function variance(current: number, prior: number) {
  const deltaAbs = current - prior
  const deltaPct = prior === 0 ? (current === 0 ? 0 : null) : (deltaAbs / Math.abs(prior)) * 100
  return { deltaAbs, deltaPct }
}

export default async function ProfitAndLossReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const tab = typeof p.tab === 'string' ? p.tab : 'default'
  const basis: 'accrual' | 'cash' = (typeof p.basis === 'string' && p.basis === 'cash') ? 'cash' : 'accrual'
  const customRange = resolveCustomReportRange(
    typeof p.start === 'string' ? p.start : undefined,
    typeof p.end === 'string' ? p.end : undefined
  )
  const company = await getCompanySettings()
  const { start, end, label } = customRange ?? resolveReportRange(preset, undefined, company.fiscalYearEnd)
  // Accrual P&L is computed from the GL, which is maintained in CAD — so on accrual
  // basis the report is always CAD regardless of any ?currency= selection. The cash-basis
  // branch still honours the requested currency against the legacy source tables.
  const requestedCurrency = parseCurrencyParam(p) || GL_CURRENCY
  const currency = basis === 'cash' ? requestedCurrency : GL_CURRENCY

  const current = await computePL(start, end, currency, basis)
  const { totalIncome, incomeByAcct, expenseByCat, totalExpenses, netProfit } = current
  const grossProfit = totalIncome
  const grossMargin = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0
  const netMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0

  // Cash basis reads the legacy payments/expense tables, so books maintained
  // entirely in the general ledger render all zeros there. Say so rather than
  // letting an empty report read as missing data.
  const cashEmptyNotice =
    basis === 'cash' && totalIncome === 0 && totalExpenses === 0 ? (
      <div className="mb-4 px-4 py-3 rounded border border-[#FFD3A0] bg-[#FFF7EC] text-sm text-[#8B4513] print:hidden">
        No cash-basis records in this range. Cash basis reads invoice payments and logged expenses —
        books maintained entirely in the general ledger have none. Switch to <strong>Accrual</strong> for
        the GL-based figures.
      </div>
    ) : null

  // The column-mode tabs read "By …" so they don't blur into the date-preset
  // shortcuts beside them ("Last Quarter" sets a range; "By Quarter" sets the
  // columns). Values are unchanged, so existing ?tab= links keep working — and
  // none of them collide with a preset key, which ReportLayout would otherwise
  // treat as a range switch rather than a view switch.
  const tabs = [
    { value: 'default', label: 'This Year' },
    { value: 'last-quarter', label: 'Last Quarter' },
    { value: 'vs-last-year', label: 'This Year vs Last Year' },
    { value: 'percent', label: '% of Income' },
    { value: 'monthly', label: 'By Month' },
    { value: 'quarterly', label: 'By Quarter' },
    // Fiscal quarters only differ from calendar ones off a Dec 31 year-end.
    ...(isCalendarFiscalYear(company.fiscalYearEnd)
      ? []
      : [{ value: 'fiscal-quarterly', label: 'By Fiscal Quarter' }]),
  ]

  // Income rows: on GL/accrual basis, one row per income account. Cash basis (no GL
  // breakdown) collapses to a single "Sales & Services" line.
  const incomeRows: { name: string; total: number }[] =
    incomeByAcct.size > 0
      ? Array.from(incomeByAcct.values())
      : [{ name: 'Sales & Services', total: totalIncome }]

  if (tab === 'vs-last-year') {
    const prior = priorYearRange({ start, end })
    const priorData = await computePL(prior.start, prior.end, currency, basis)

    // Merge categories across both periods so we show every row even if one side is zero.
    const catKeys = new Set<string>([...expenseByCat.keys(), ...priorData.expenseByCat.keys()])
    const expenseRows = Array.from(catKeys).map((k) => {
      const cur = expenseByCat.get(k)
      const prv = priorData.expenseByCat.get(k)
      return {
        name: cur?.name || prv?.name || '—',
        current: cur?.total || 0,
        prior: prv?.total || 0,
      }
    })

    // Income rows merged across both periods (GL/accrual basis). On cash basis there is no
    // GL breakdown, so collapse to a single "Sales & Services" line.
    const incomeRowsVs =
      incomeByAcct.size > 0 || priorData.incomeByAcct.size > 0
        ? Array.from(
            new Set<string>([...incomeByAcct.keys(), ...priorData.incomeByAcct.keys()])
          ).map((k) => {
            const cur = incomeByAcct.get(k)
            const prv = priorData.incomeByAcct.get(k)
            return {
              name: cur?.name || prv?.name || '—',
              current: cur?.total || 0,
              prior: prv?.total || 0,
            }
          })
        : [{ name: 'Sales & Services', current: totalIncome, prior: priorData.totalIncome }]

    const incomeVar = variance(totalIncome, priorData.totalIncome)
    const expenseVar = variance(totalExpenses, priorData.totalExpenses)
    const netVar = variance(netProfit, priorData.netProfit)

    return (
      <ReportLayout
        title="Profit and Loss"
        rangeLabel={label}
        currentPreset={preset}
        currency={currency}
        updatedBadge
        tabs={tabs}
        companyName={company.legalName || company.name}
        fiscalYearEnd={company.fiscalYearEnd}
        showBasisToggle
        showCompactToggle
        hasExport
      >
        {cashEmptyNotice}
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Current</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Prior Year</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Change ($)</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Change (%)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <td colSpan={5} className="px-4 py-2 text-sm font-semibold text-[#001B40]">Income</td>
            </tr>
            {incomeRowsVs.map((r, i) => {
              const v = variance(r.current, r.prior)
              return (
                <tr key={i} className="border-b border-[#E1E6EB]">
                  <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{r.name}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(r.current, currency, { includeCode: false })}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(r.prior, currency, { includeCode: false })}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(v.deltaAbs, currency, { includeCode: false })}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#576981]">{v.deltaPct === null ? '—' : `${v.deltaPct.toFixed(1)}%`}</td>
                </tr>
              )
            })}
            <tr className="border-b border-[#E1E6EB] bg-[#F5F7FA]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total Income</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(totalIncome, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(priorData.totalIncome, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(incomeVar.deltaAbs, currency)}</td>
              <td className="px-4 py-1 text-sm text-right text-[#576981]">{incomeVar.deltaPct === null ? '—' : `${incomeVar.deltaPct.toFixed(1)}%`}</td>
            </tr>

            <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <td colSpan={5} className="px-4 py-2 text-sm font-semibold text-[#001B40]">Expenses</td>
            </tr>
            {expenseRows.map((r, i) => {
              const v = variance(r.current, r.prior)
              return (
                <tr key={i} className="border-b border-[#E1E6EB]">
                  <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{r.name}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(r.current, currency, { includeCode: false })}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(r.prior, currency, { includeCode: false })}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(v.deltaAbs, currency, { includeCode: false })}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#576981]">{v.deltaPct === null ? '—' : `${v.deltaPct.toFixed(1)}%`}</td>
                </tr>
              )
            })}
            <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total Expenses</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(totalExpenses, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(priorData.totalExpenses, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(expenseVar.deltaAbs, currency)}</td>
              <td className="px-4 py-1 text-sm text-right text-[#576981]">{expenseVar.deltaPct === null ? '—' : `${expenseVar.deltaPct.toFixed(1)}%`}</td>
            </tr>

            <tr className="border-t-2 border-[#001B40]">
              <td className="px-4 py-1 text-base font-bold text-[#001B40]">Net Profit</td>
              <td className={`px-4 py-3 text-base text-right font-bold ${netProfit >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{formatCurrency(netProfit, currency)}</td>
              <td className={`px-4 py-3 text-base text-right font-bold ${priorData.netProfit >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{formatCurrency(priorData.netProfit, currency)}</td>
              <td className="px-4 py-1 text-base text-right font-bold text-[#001B40]">{formatCurrency(netVar.deltaAbs, currency)}</td>
              <td className="px-4 py-1 text-base text-right text-[#576981]">{netVar.deltaPct === null ? '—' : `${netVar.deltaPct.toFixed(1)}%`}</td>
            </tr>
          </tbody>
        </table>
      </ReportLayout>
    )
  }

  if (tab === 'percent') {
    const pct = (n: number) => (totalIncome > 0 ? (n / totalIncome) * 100 : 0)
    return (
      <ReportLayout
        title="Profit and Loss"
        rangeLabel={label}
        currentPreset={preset}
        currency={currency}
        updatedBadge
        tabs={tabs}
        companyName={company.legalName || company.name}
        fiscalYearEnd={company.fiscalYearEnd}
        showBasisToggle
        showCompactToggle
        hasExport
      >
        {cashEmptyNotice}
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Amount</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981] w-28">% of Income</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-[#001B40]">Income</td>
            </tr>
            {incomeRows.map((r, i) => (
              <tr key={i} className="border-b border-[#E1E6EB]">
                <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{r.name}</td>
                <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(r.total, currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right text-[#576981]">{pct(r.total).toFixed(1)}%</td>
              </tr>
            ))}
            <tr className="border-b border-[#E1E6EB] bg-[#F5F7FA]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total Income</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(totalIncome, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">100.0%</td>
            </tr>

            <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-[#001B40]">Expenses</td>
            </tr>
            {Array.from(expenseByCat.values()).map((cat, i) => (
              <tr key={i} className="border-b border-[#E1E6EB]">
                <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{cat.name}</td>
                <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(cat.total, currency, { includeCode: false })}</td>
                <td className="px-4 py-1 text-sm text-right text-[#576981]">{pct(cat.total).toFixed(1)}%</td>
              </tr>
            ))}
            <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total Expenses</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(totalExpenses, currency)}</td>
              <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">{pct(totalExpenses).toFixed(1)}%</td>
            </tr>

            <tr className="border-t-2 border-[#001B40]">
              <td className="px-4 py-1 text-base font-bold text-[#001B40]">Net Profit</td>
              <td className={`px-4 py-3 text-base text-right font-bold ${netProfit >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{formatCurrency(netProfit, currency)}</td>
              <td className="px-4 py-1 text-base text-right font-bold text-[#001B40]">{pct(netProfit).toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </ReportLayout>
    )
  }

  if (tab === 'monthly' || tab === 'quarterly' || tab === 'fiscal-quarterly') {
    const periodPL =
      tab === 'quarterly'
        ? await computeQuarterlyPL(start, end, currency, basis)
        : tab === 'fiscal-quarterly'
          ? await computeFiscalQuarterlyPL(start, end, currency, basis, company.fiscalYearEnd)
          : await computeMonthlyPL(start, end, currency, basis)

    return (
      <ReportLayout
        title="Profit and Loss"
        rangeLabel={label}
        currentPreset={preset}
        currency={currency}
        updatedBadge
        tabs={tabs}
        companyName={company.legalName || company.name}
        fiscalYearEnd={company.fiscalYearEnd}
        showBasisToggle
        showCompactToggle
        hasExport
      >
        {cashEmptyNotice}
        <PeriodPLTable data={periodPL} currency={currency} />
      </ReportLayout>
    )
  }

  return (
    <ReportLayout
      title="Profit and Loss"
      rangeLabel={label}
      currentPreset={preset}
      currency={currency}
      updatedBadge
      tabs={tabs}
      companyName={company.legalName || company.name}
      fiscalYearEnd={company.fiscalYearEnd}
      showBasisToggle
      showCompactToggle
      hasExport
    >
      {cashEmptyNotice}
      <table className="w-full">
        <tbody>
          <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
            <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Income</td>
            <td className="px-4 py-1" />
          </tr>
          {incomeRows.map((r, i) => (
            <tr key={i} className="border-b border-[#E1E6EB]">
              <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{r.name}</td>
              <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                {formatCurrency(r.total, currency, { includeCode: false })}
              </td>
            </tr>
          ))}
          <tr className="border-b border-[#E1E6EB] bg-[#F5F7FA]">
            <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total Income</td>
            <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">
              {formatCurrency(totalIncome, currency)}
            </td>
          </tr>

          <tr className="border-b border-[#E1E6EB] italic">
            <td className="px-4 py-1 text-sm text-[#576981]">Gross Profit</td>
            <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">
              {formatCurrency(grossProfit, currency)}
            </td>
          </tr>
          <tr className="border-b border-[#E1E6EB] italic">
            <td className="px-4 py-1 text-sm text-[#576981]">Gross Profit Margin</td>
            <td className="px-4 py-1 text-sm text-right text-[#001B40]">{grossMargin.toFixed(1)}%</td>
          </tr>

          <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
            <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Expenses</td>
            <td className="px-4 py-1" />
          </tr>
          {Array.from(expenseByCat.values()).map((cat, i) => (
            <tr key={i} className="border-b border-[#E1E6EB]">
              <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{cat.name}</td>
              <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                {formatCurrency(cat.total, currency, { includeCode: false })}
              </td>
            </tr>
          ))}
          <tr className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
            <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total Expenses</td>
            <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">
              {formatCurrency(totalExpenses, currency)}
            </td>
          </tr>

          <tr className="border-t-2 border-[#001B40]">
            <td className="px-4 py-1 text-base font-bold text-[#001B40]">Net Profit</td>
            <td className={`px-4 py-3 text-base text-right font-bold ${netProfit >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>
              {formatCurrency(netProfit, currency)}
            </td>
          </tr>
          <tr className="italic">
            <td className="px-4 py-1 text-sm text-[#576981]">Net Profit Margin</td>
            <td className="px-4 py-1 text-sm text-right text-[#001B40]">{netMargin.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    </ReportLayout>
  )
}
