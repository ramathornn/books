export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { parseCurrencyParam, defaultExpenseCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Expense Report — Reports' }

export default async function ExpenseReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultExpenseCurrency())

  const expenses = await prisma.expense.findMany({
    where: { date: { gte: start, lte: end }, isArchived: false, currency },
    include: { category: true, vendor: true },
    orderBy: [{ categoryId: 'asc' }, { date: 'desc' }],
  })

  const byCategory = new Map<string, { name: string; items: typeof expenses; total: number }>()
  for (const e of expenses) {
    const k = e.categoryId
    if (!byCategory.has(k)) byCategory.set(k, { name: e.category.name, items: [] as unknown as typeof expenses, total: 0 })
    const entry = byCategory.get(k)!
    entry.items.push(e)
    entry.total += Number(e.total)
  }
  const grandTotal = expenses.reduce((s, e) => s + Number(e.total), 0)

  return (
    <ReportLayout title="Expense Report" rangeLabel={`Grouped by Category (${currency}) — ${label}`} currentPreset={preset} currency={currency} fiscalYearEnd={company.fiscalYearEnd}>
      {expenses.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No expenses found in this time period. Please adjust the range.
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Category / Item</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Count</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Amount</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byCategory.values()).map((cat) => (
              <>
                <tr key={`cat-${cat.name}`} className="border-b border-[#E1E6EB] bg-[#F5F7FA]">
                  <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">{cat.name}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">{cat.items.length}</td>
                  <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">
                    {formatCurrency(cat.total, currency, { includeCode: false })}
                  </td>
                </tr>
                {cat.items.map((e) => (
                  <tr key={e.id} className="border-b border-[#E1E6EB]">
                    <td className="px-4 py-1 pl-8 text-sm text-[#001B40]">
                      <div>{e.vendor?.name || e.description || '(no vendor)'}</div>
                      <div className="text-xs text-[#576981]">{formatDate(e.date)}</div>
                    </td>
                    <td className="px-4 py-1" />
                    <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                      {formatCurrency(Number(e.total), e.currency, { includeCode: false })}
                    </td>
                  </tr>
                ))}
              </>
            ))}
            <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
              <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">Grand Total</td>
              <td className="px-4 py-1 text-sm text-right text-[#001B40]">{expenses.length}</td>
              <td className="px-4 py-1 text-sm text-right font-bold text-[#001B40]">
                {formatCurrency(grandTotal, currency)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </ReportLayout>
  )
}
