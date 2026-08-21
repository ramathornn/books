export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDateLong } from '@/lib/utils'
import { parseCurrencyParam, defaultGLAccountCurrency } from '@/lib/reportCurrency'
import { balancesAsOf, parseAsOfParam } from '@/lib/glBalances'
import { resolveReportRange } from '@/lib/reportRange'
import ReportLayout from '@/components/reports/ReportLayout'
import { getCompanySettings } from '@/lib/company'

export const metadata: Metadata = { title: 'Balance Sheet — Reports' }

type Account = Awaited<ReturnType<typeof prisma.gLAccount.findMany>>[number]

export default async function BalanceSheetReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const tab = typeof p.tab === 'string' ? p.tab : 'default'
  const currency = parseCurrencyParam(p) || (await defaultGLAccountCurrency())
  const company = await getCompanySettings()

  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false, currency },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })

  const assets = accounts.filter((a) => a.accountClass === 'asset')
  const liabilities = accounts.filter((a) => a.accountClass === 'liability')
  const equity = accounts.filter((a) => a.accountClass === 'equity')
  const income = accounts.filter((a) => a.accountClass === 'income')
  const expenses = accounts.filter((a) => a.accountClass === 'expense')

  // "As of" date: an explicit ?asOf wins; otherwise the selected period preset's
  // end-date — so the "Last Month" tab and the Date Range dropdown (which set
  // ?preset, not ?asOf) actually move the statement date; with neither, today.
  // (Matches how the Trial Balance report resolves its as-of date.)
  const preset = typeof p.preset === 'string' ? p.preset : undefined
  const asOf =
    typeof p.asOf === 'string' || Array.isArray(p.asOf)
      ? parseAsOfParam(p.asOf)
      : preset
        ? resolveReportRange(preset).end
        : parseAsOfParam(undefined)
  const currentBalances = await balancesAsOf(accounts, asOf)
  const currentBal = (a: Account) => currentBalances.get(a.id) || 0

  // Current Year Earnings: net income (revenue − expenses) of the open period,
  // i.e. activity not yet rolled into Retained Earnings by a fiscal-year close.
  // The close zeroes every income/expense account into RE (see fiscalYearClose),
  // so summing posted income/expense balances as-of the date is exactly the
  // *unclosed* net income — it makes the BS balance pre-close and resets to ~0
  // once the year is closed. Computed as an equity line; no schema, no extra query.
  const netIncomeFrom = (bal: (a: Account) => number) =>
    income.reduce((s, a) => s + bal(a), 0) - expenses.reduce((s, a) => s + bal(a), 0)
  const currentYearEarnings = netIncomeFrom(currentBal)

  const totalAssets = assets.reduce((s, a) => s + currentBal(a), 0)
  const totalLiabilities = liabilities.reduce((s, a) => s + currentBal(a), 0)
  const totalEquity = equity.reduce((s, a) => s + currentBal(a), 0) + currentYearEarnings

  const tabs = [
    { value: 'default', label: 'Today' },
    { value: 'last-month', label: 'Last Month' },
    { value: 'vs-last-year', label: 'This Year vs Last Year' },
  ]

  if (tab === 'vs-last-year') {
    const priorAsOf = new Date(asOf)
    priorAsOf.setUTCFullYear(priorAsOf.getUTCFullYear() - 1)
    const priorBalances = await balancesAsOf(accounts, priorAsOf)
    const priorVal = (a: Account) => priorBalances.get(a.id) || 0

    const priorCurrentYearEarnings = netIncomeFrom(priorVal)
    const priorTotalAssets = assets.reduce((s, a) => s + priorVal(a), 0)
    const priorTotalLiabilities = liabilities.reduce((s, a) => s + priorVal(a), 0)
    const priorTotalEquity = equity.reduce((s, a) => s + priorVal(a), 0) + priorCurrentYearEarnings

    function VsSection({
      title,
      list,
      total,
      priorTotal,
      extraRows = [],
    }: {
      title: string
      list: Account[]
      total: number
      priorTotal: number
      extraRows?: { label: string; current: number; prior: number }[]
    }) {
      return (
        <div className="mb-6">
          <h3 className="text-base font-semibold text-[#001B40] bg-[#F5F7FA] px-4 py-2 rounded-t border border-[#E1E6EB]">
            {title}
          </h3>
          <table className="w-full border-x border-b border-[#E1E6EB]">
            <thead>
              <tr className="border-b border-[#E1E6EB]">
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account</th>
                <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">As of {formatDateLong(asOf)}</th>
                <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">As of {formatDateLong(priorAsOf)}</th>
                <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Change ($)</th>
                <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Change (%)</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const cur = currentBal(a)
                const prv = priorVal(a)
                const delta = cur - prv
                const pct = prv === 0 ? (cur === 0 ? 0 : null) : (delta / Math.abs(prv)) * 100
                return (
                  <tr key={a.id} className="border-t border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#001B40] pl-8">
                      {a.accountName}
                      <span className="text-xs text-[#576981] ml-2">{a.accountNumber}</span>
                    </td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(cur, a.currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(prv, a.currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(delta, a.currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#576981]">{pct === null ? '—' : `${pct.toFixed(1)}%`}</td>
                  </tr>
                )
              })}
              {extraRows.map((row) => {
                const delta = row.current - row.prior
                const pct = row.prior === 0 ? (row.current === 0 ? 0 : null) : (delta / Math.abs(row.prior)) * 100
                return (
                  <tr key={`extra-${row.label}`} className="border-t border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#001B40] pl-8">{row.label}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(row.current, currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(row.prior, currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">{formatCurrency(delta, currency, { includeCode: false })}</td>
                    <td className="px-4 py-1 text-sm text-right text-[#576981]">{pct === null ? '—' : `${pct.toFixed(1)}%`}</td>
                  </tr>
                )
              })}
              <tr className="border-t-2 border-[#001B40] bg-[#F5F7FA]">
                <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total {title}</td>
                <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(total, currency)}</td>
                <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(priorTotal, currency)}</td>
                <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">{formatCurrency(total - priorTotal, currency)}</td>
                <td className="px-4 py-1 text-sm text-right text-[#576981]">
                  {priorTotal === 0 ? '—' : `${(((total - priorTotal) / Math.abs(priorTotal)) * 100).toFixed(1)}%`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )
    }

    return (
      <ReportLayout
        title="Balance Sheet"
        rangeLabel={`As of ${formatDateLong(asOf)} vs ${formatDateLong(priorAsOf)}`}
        currentPreset="today"
        currency={currency}
        updatedBadge
        tabs={tabs}
        companyName={company.legalName || company.name}
        showCompactToggle
      >
        <VsSection title="Assets" list={assets} total={totalAssets} priorTotal={priorTotalAssets} />
        <VsSection title="Liabilities" list={liabilities} total={totalLiabilities} priorTotal={priorTotalLiabilities} />
        <VsSection
          title="Equity"
          list={equity}
          total={totalEquity}
          priorTotal={priorTotalEquity}
          extraRows={[{ label: 'Current Year Earnings', current: currentYearEarnings, prior: priorCurrentYearEarnings }]}
        />

        <div className="mt-6 pt-4 border-t-2 border-[#001B40]">
          <div className="flex justify-between text-sm">
            <span className="font-semibold text-[#001B40]">Total Liabilities & Equity (current)</span>
            <span className="font-bold text-[#001B40]">
              {formatCurrency(totalLiabilities + totalEquity, currency)}
            </span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="font-semibold text-[#001B40]">Total Liabilities & Equity (prior)</span>
            <span className="font-bold text-[#001B40]">
              {formatCurrency(priorTotalLiabilities + priorTotalEquity, currency)}
            </span>
          </div>
        </div>
      </ReportLayout>
    )
  }

  function Section({
    title,
    accounts,
    total,
    extraRows = [],
  }: {
    title: string
    accounts: Account[]
    total: number
    extraRows?: { label: string; amount: number }[]
  }) {
    const bySubclass = new Map<string, Account[]>()
    for (const a of accounts) {
      const k = a.accountSubclass || 'Other'
      if (!bySubclass.has(k)) bySubclass.set(k, [])
      bySubclass.get(k)!.push(a)
    }
    return (
      <div className="mb-6">
        <h3 className="text-base font-semibold text-[#001B40] bg-[#F5F7FA] px-4 py-2 rounded-t border border-[#E1E6EB]">
          {title}
        </h3>
        <table className="w-full border-x border-b border-[#E1E6EB]">
          <tbody>
            {Array.from(bySubclass.entries()).map(([sub, accts]) => (
              <>
                <tr key={`sub-${sub}`} className="bg-[#FFFEFD] border-t border-[#E1E6EB]">
                  <td className="px-4 py-1.5 text-xs font-semibold text-[#576981] uppercase">{sub}</td>
                  <td />
                </tr>
                {accts.map((a) => (
                  <tr key={a.id} className="border-t border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#001B40] pl-8">
                      {a.accountName}
                      <span className="text-xs text-[#576981] ml-2">{a.accountNumber}</span>
                    </td>
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                      {formatCurrency(currentBal(a), a.currency, { includeCode: false })}
                    </td>
                  </tr>
                ))}
              </>
            ))}
            {extraRows.map((row) => (
              <tr key={`extra-${row.label}`} className="border-t border-[#E1E6EB]">
                <td className="px-4 py-1 text-sm text-[#001B40] pl-8">{row.label}</td>
                <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                  {formatCurrency(row.amount, currency, { includeCode: false })}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-[#001B40] bg-[#F5F7FA]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Total {title}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">
                {formatCurrency(total, currency)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <ReportLayout
      title="Balance Sheet"
      rangeLabel={`As of ${formatDateLong(asOf)}`}
      currentPreset="today"
      currency={currency}
      updatedBadge
      tabs={tabs}
      companyName={company.legalName || company.name}
      showCompactToggle
    >
      <Section title="Assets" accounts={assets} total={totalAssets} />
      <Section title="Liabilities" accounts={liabilities} total={totalLiabilities} />
      <Section
        title="Equity"
        accounts={equity}
        total={totalEquity}
        extraRows={[{ label: 'Current Year Earnings', amount: currentYearEarnings }]}
      />

      <div className="mt-6 pt-4 border-t-2 border-[#001B40]">
        <div className="flex justify-between text-sm">
          <span className="font-semibold text-[#001B40]">Total Liabilities & Equity</span>
          <span className="font-bold text-[#001B40]">
            {formatCurrency(totalLiabilities + totalEquity, currency)}
          </span>
        </div>
        {Math.abs(totalAssets - (totalLiabilities + totalEquity)) > 0.01 && (
          <div className="mt-2 text-xs text-[#BF2600]">
            ⚠ Balance sheet is out of balance by{' '}
            {formatCurrency(totalAssets - (totalLiabilities + totalEquity), currency)}
          </div>
        )}
      </div>
    </ReportLayout>
  )
}
