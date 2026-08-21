export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Journal Entry — Reports' }

export default async function JournalEntryReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-month'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)

  const entries = await prisma.journalEntry.findMany({
    where: { entryDate: { gte: start, lte: end } },
    include: { lines: { include: { glAccount: true } } },
    orderBy: { entryDate: 'asc' },
  })

  const currency = 'CAD'

  return (
    <ReportLayout
      title="Journal Entry"
      breadcrumbLabel="Journal Entries"
      breadcrumbHref="/accounting/journal-entries"
      rangeLabel={label}
      currentPreset={preset}
      fiscalYearEnd={company.fiscalYearEnd}
    >
      {entries.length === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No active accounts found. Please adjust the range.
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Date</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Entry #</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account / Memo</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Debit</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <>
                <tr key={`head-${e.id}`} className="bg-[#F5F7FA] border-t border-[#E1E6EB]">
                  <td className="px-4 py-1 text-sm text-[#001B40]">{formatDate(e.entryDate)}</td>
                  <td className="px-4 py-1 text-sm">
                    <Link href={`/accounting/journal-entries/${e.id}`} className="text-[#0075DD] hover:underline">
                      {e.entryNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-1 text-sm font-semibold text-[#001B40]">
                    {e.description || e.memo}
                  </td>
                  <td className="px-4 py-1 text-sm text-right font-semibold">
                    {formatCurrency(Number(e.totalDebit), currency, { includeCode: false })}
                  </td>
                  <td className="px-4 py-1 text-sm text-right font-semibold">
                    {formatCurrency(Number(e.totalCredit), currency, { includeCode: false })}
                  </td>
                </tr>
                {e.lines.map((l) => (
                  <tr key={l.id} className="border-t border-[#E1E6EB]">
                    <td />
                    <td />
                    <td className="px-4 py-1.5 pl-8 text-sm text-[#576981]">
                      {l.glAccount.accountNumber} — {l.glAccount.accountName}
                      {l.description && <span className="ml-2 italic">({l.description})</span>}
                    </td>
                    <td className="px-4 py-1.5 text-sm text-right text-[#001B40]">
                      {Number(l.debit) > 0 ? formatCurrency(Number(l.debit), currency, { includeCode: false }) : '—'}
                    </td>
                    <td className="px-4 py-1.5 text-sm text-right text-[#001B40]">
                      {Number(l.credit) > 0 ? formatCurrency(Number(l.credit), currency, { includeCode: false }) : '—'}
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      )}
    </ReportLayout>
  )
}
