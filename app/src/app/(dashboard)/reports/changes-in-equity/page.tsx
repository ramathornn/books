export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { getCompanySettings } from '@/lib/company'
import { resolveReportRange } from '@/lib/reportRange'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Statement of Changes in Equity — Reports' }

export default async function ChangesInEquityReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-year'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)

  const [equityAccounts, allLines, incomeAccounts, expenseAccounts] = await Promise.all([
    prisma.gLAccount.findMany({
      where: { accountClass: 'equity', isArchived: false },
      orderBy: { accountNumber: 'asc' },
    }),
    prisma.journalEntryLine.findMany({
      where: { journalEntry: { status: 'posted', entryDate: { lte: end } } },
      select: {
        glAccountId: true,
        debit: true,
        credit: true,
        journalEntry: { select: { entryDate: true } },
      },
    }),
    prisma.gLAccount.findMany({
      where: { accountClass: 'income', isArchived: false },
    }),
    prisma.gLAccount.findMany({
      where: { accountClass: 'expense', isArchived: false },
    }),
  ])

  // Compute opening (before start) and movement (start..end) per equity account
  const equityRows = equityAccounts.map((a) => {
    let opening = 0
    let movement = 0
    for (const l of allLines) {
      if (l.glAccountId !== a.id) continue
      const credit = Number(l.credit || 0)
      const debit = Number(l.debit || 0)
      // equity is credit-normal: credit increases balance
      const delta = credit - debit
      if (l.journalEntry.entryDate < start) {
        opening += delta
      } else {
        movement += delta
      }
    }
    return { account: a, opening, movement, closing: opening + movement }
  })

  // Net income for the period (rolls into Retained Earnings movement)
  let periodIncome = 0
  for (const l of allLines) {
    const inIncome = incomeAccounts.find((a) => a.id === l.glAccountId)
    const inExpense = expenseAccounts.find((a) => a.id === l.glAccountId)
    if (l.journalEntry.entryDate < start || l.journalEntry.entryDate > end) continue
    if (inIncome) periodIncome += Number(l.credit || 0) - Number(l.debit || 0)
    if (inExpense) periodIncome -= Number(l.debit || 0) - Number(l.credit || 0)
  }

  const totalOpening = equityRows.reduce((s, r) => s + r.opening, 0)
  const totalMovement = equityRows.reduce((s, r) => s + r.movement, 0)
  const totalClosing = equityRows.reduce((s, r) => s + r.closing, 0)

  return (
    <ReportLayout
      title="Statement of Changes in Equity"
      rangeLabel={label}
      currentPreset={preset}
      companyName={company.legalName || company.name}
      fiscalYearEnd={company.fiscalYearEnd}
      showCompactToggle
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E1E6EB]">
            <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Account</th>
            <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">
              Opening ({start.toISOString().slice(0, 10)})
            </th>
            <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">Movement</th>
            <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">
              Closing ({end.toISOString().slice(0, 10)})
            </th>
          </tr>
        </thead>
        <tbody>
          {equityRows.map((r) => (
            <tr key={r.account.id} className="border-b border-[#E1E6EB]">
              <td className="py-1 px-2 text-[#001B40]">
                <span className="font-mono text-xs text-[#576981] mr-2">{r.account.accountNumber}</span>
                {r.account.accountName}
              </td>
              <td className="py-1 px-2 text-right font-mono">
                {formatCurrency(r.opening, 'CAD', { includeCode: false })}
              </td>
              <td className="py-1 px-2 text-right font-mono">
                {formatCurrency(r.movement, 'CAD', { includeCode: false })}
              </td>
              <td className="py-1 px-2 text-right font-mono font-semibold">
                {formatCurrency(r.closing, 'CAD', { includeCode: false })}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#001B40]">
            <td className="py-2 px-2 text-xs font-semibold text-[#576981]">Total recorded equity</td>
            <td className="py-2 px-2 text-right font-mono font-semibold text-[#001B40]">
              {formatCurrency(totalOpening, 'CAD', { includeCode: false })}
            </td>
            <td className="py-2 px-2 text-right font-mono font-semibold text-[#001B40]">
              {formatCurrency(totalMovement, 'CAD', { includeCode: false })}
            </td>
            <td className="py-2 px-2 text-right font-mono font-bold text-[#001B40]">
              {formatCurrency(totalClosing, 'CAD', { includeCode: false })}
            </td>
          </tr>
          <tr className="bg-[#F5F7FA]">
            <td className="py-2 px-2 text-xs text-[#576981]">
              Net income for period (closes into Retained Earnings at year-end)
            </td>
            <td colSpan={2} />
            <td className="py-2 px-2 text-right font-mono font-semibold text-[#001B40]">
              {formatCurrency(periodIncome, 'CAD', { includeCode: false })}
            </td>
          </tr>
        </tfoot>
      </table>
    </ReportLayout>
  )
}
