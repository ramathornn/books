export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDateLong } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { parseCurrencyParam, defaultGLAccountCurrency } from '@/lib/reportCurrency'
import { balancesAsOf, parseAsOfParam } from '@/lib/glBalances'
import ReportLayout from '@/components/reports/ReportLayout'
import ExportForT2Button from './ExportForT2Button'

export const metadata: Metadata = { title: 'Trial Balance — Reports' }

const CLASS_LABELS: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
}

export default async function TrialBalanceReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'last-month'
  const currency = parseCurrencyParam(p) || (await defaultGLAccountCurrency())

  // "As of" date: explicit asOf param wins; otherwise the selected preset's end
  // (so the period tabs keep working); defaults to today via parseAsOfParam.
  const end =
    typeof p.asOf === 'string' || Array.isArray(p.asOf)
      ? parseAsOfParam(p.asOf)
      : resolveReportRange(preset).end

  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false, currency },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })

  // Balances as-of `end`: opening balance + sum of posted journal lines <= end.
  const balances = await balancesAsOf(accounts, end)

  // Show balance as debit or credit depending on account class
  const rows = accounts
    .map((a) => {
      const bal = balances.get(a.id) || 0
      const isDebitNormal = a.accountClass === 'asset' || a.accountClass === 'expense'
      return {
        ...a,
        debit: isDebitNormal ? Math.max(0, bal) : Math.max(0, -bal),
        credit: isDebitNormal ? Math.max(0, -bal) : Math.max(0, bal),
      }
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)

  const byClass = new Map<string, typeof rows>()
  for (const r of rows) {
    const k = r.accountClass
    if (!byClass.has(k)) byClass.set(k, [] as unknown as typeof rows)
    byClass.get(k)!.push(r)
  }

  return (
    <ReportLayout
      title="Trial Balance"
      rangeLabel={`As of ${formatDateLong(end)}`}
      currentPreset={preset}
      currency={currency}
      updatedBadge
      tabs={[
        { value: 'default', label: 'Last Month' },
        { value: 'last-quarter', label: 'Last Quarter' },
        { value: 'last-year', label: 'Last Year' },
      ]}
    >
      <div className="flex justify-end mb-3 print:hidden">
        <ExportForT2Button />
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E1E6EB]">
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account Name</th>
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account #</th>
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Sub Type</th>
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">GIFI</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Debit</th>
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit</th>
          </tr>
        </thead>
        <tbody>
          {Array.from(byClass.entries()).map(([cls, accts]) => (
            <>
              <tr key={`cls-${cls}`} className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
                <td colSpan={6} className="px-4 py-2 text-sm font-semibold text-[#001B40]">
                  {CLASS_LABELS[cls]}
                </td>
              </tr>
              {accts.map((r) => (
                <tr key={r.id} className="border-b border-[#E1E6EB]">
                  <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">{r.accountName}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{r.accountNumber}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{r.accountSubclass}</td>
                  <td className="px-4 py-1 text-sm text-[#576981] font-mono">{r.gifiCode || '—'}</td>
                  <td className="px-4 py-1 text-sm text-right">
                    {r.debit ? formatCurrency(r.debit, currency, { includeCode: false }) : '—'}
                  </td>
                  <td className="px-4 py-1 text-sm text-right">
                    {r.credit ? formatCurrency(r.credit, currency, { includeCode: false }) : '—'}
                  </td>
                </tr>
              ))}
            </>
          ))}
          <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
            <td colSpan={4} className="px-4 py-3 text-sm font-semibold">Total</td>
            <td className="px-4 py-1 text-sm text-right font-bold">
              {formatCurrency(totalDebit, currency)}
            </td>
            <td className="px-4 py-1 text-sm text-right font-bold">
              {formatCurrency(totalCredit, currency)}
            </td>
          </tr>
        </tbody>
      </table>
    </ReportLayout>
  )
}
