export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { getCompanySettings } from '@/lib/company'
import { resolveReportRange } from '@/lib/reportRange'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'GST/HST Detail — Reports' }

export default async function SalesTaxDetailReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-quarter'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)

  const gstPayable = await prisma.gLAccount.findFirst({ where: { accountNumber: '2315' } })

  if (!gstPayable) {
    return (
      <ReportLayout
        title="GST/HST Detail"
        rangeLabel={label}
        currentPreset={preset}
        companyName={company.legalName || company.name}
        fiscalYearEnd={company.fiscalYearEnd}
      >
        <p className="text-sm text-[#576981] text-center py-8">
          No GST/HST Payable account (2315) in the Chart of Accounts.
        </p>
      </ReportLayout>
    )
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: gstPayable.id,
      journalEntry: {
        status: 'posted',
        entryDate: { gte: start, lte: end },
      },
    },
    include: {
      journalEntry: { select: { entryNumber: true, entryDate: true, description: true } },
    },
    orderBy: { journalEntry: { entryDate: 'asc' } },
  })

  let totalCollected = 0
  let totalPaid = 0
  for (const l of lines) {
    totalCollected += Number(l.credit)
    totalPaid += Number(l.debit)
  }
  const net = totalCollected - totalPaid

  return (
    <ReportLayout
      title="GST/HST Detail Report"
      rangeLabel={label}
      currentPreset={preset}
      companyName={company.legalName || company.name}
      fiscalYearEnd={company.fiscalYearEnd}
      showCompactToggle
    >
      {lines.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">No GST/HST activity in this period.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Date</th>
              <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">JE</th>
              <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Description</th>
              <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">ITC (Debit)</th>
              <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">Collected (Credit)</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-[#E1E6EB]">
                <td className="py-1 px-2 text-xs text-[#001B40] whitespace-nowrap">
                  {l.journalEntry.entryDate.toISOString().slice(0, 10)}
                </td>
                <td className="py-1 px-2 font-mono text-xs text-[#0075DD]">
                  {l.journalEntry.entryNumber}
                </td>
                <td className="py-1 px-2 text-[#001B40] truncate max-w-[400px]">
                  {l.description || l.journalEntry.description}
                </td>
                <td className="py-1 px-2 text-right font-mono text-[#001B40]">
                  {Number(l.debit) > 0 ? formatCurrency(Number(l.debit), 'CAD', { includeCode: false }) : '—'}
                </td>
                <td className="py-1 px-2 text-right font-mono text-[#001B40]">
                  {Number(l.credit) > 0 ? formatCurrency(Number(l.credit), 'CAD', { includeCode: false }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#001B40]">
              <td colSpan={3} className="py-2 px-2 text-xs font-semibold text-[#576981] text-right">
                Totals
              </td>
              <td className="py-2 px-2 text-right font-mono font-semibold text-[#001B40]">
                {formatCurrency(totalPaid, 'CAD', { includeCode: false })}
              </td>
              <td className="py-2 px-2 text-right font-mono font-semibold text-[#001B40]">
                {formatCurrency(totalCollected, 'CAD', { includeCode: false })}
              </td>
            </tr>
            <tr>
              <td colSpan={4} className="py-2 px-2 text-sm font-semibold text-[#576981] text-right">
                Net (Collected − ITCs):
              </td>
              <td className="py-2 px-2 text-right font-mono font-bold text-[#001B40]">
                {formatCurrency(net, 'CAD', { includeCode: false })}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </ReportLayout>
  )
}
