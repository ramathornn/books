export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import { resolveReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { parseCurrencyParam, defaultTimeEntryCurrency } from '@/lib/reportCurrency'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Time Entry Details — Reports' }

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

export default async function TimeEntryDetailsReport({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const p = await searchParams
  const preset = typeof p.preset === 'string' ? p.preset : 'this-month'
  const company = await getCompanySettings()
  const { start, end, label } = resolveReportRange(preset, undefined, company.fiscalYearEnd)
  const currency = parseCurrencyParam(p) || (await defaultTimeEntryCurrency())

  const entries = await prisma.timeEntry.findMany({
    where: { date: { gte: start, lte: end }, currency },
    include: {
      client: true,
      project: true,
      service: true,
      teamMember: true,
    },
    orderBy: [{ projectId: 'asc' }, { date: 'asc' }],
  })


  // Group by project name
  const byProject = new Map<
    string,
    { name: string; entries: typeof entries; totalMinutes: number; totalRevenue: number }
  >()
  for (const e of entries) {
    const k = e.projectId || '__none__'
    const name = e.project?.name || '(No Project)'
    if (!byProject.has(k)) byProject.set(k, { name, entries: [] as unknown as typeof entries, totalMinutes: 0, totalRevenue: 0 })
    const g = byProject.get(k)!
    g.entries.push(e)
    g.totalMinutes += e.durationMinutes
    if (e.isBillable && e.rate) {
      g.totalRevenue += (e.durationMinutes / 60) * Number(e.rate)
    }
  }

  return (
    <ReportLayout
      title="Time Entry Details"
      rangeLabel={`Grouped by Project — ${label}`}
      currentPreset={preset}
      currency={currency}
      fiscalYearEnd={company.fiscalYearEnd}
    >
      {byProject.size === 0 ? (
        <p className="text-sm text-[#576981] text-center py-8">
          No time entries found in this time period. Please adjust the range.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(byProject.values()).map((g, i) => (
            <div key={i}>
              <div className="flex items-center justify-between bg-[#F5F7FA] border border-[#E1E6EB] rounded-t px-4 py-2">
                <h3 className="text-base font-semibold text-[#001B40]">{g.name}</h3>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[#576981]">
                    Hours: <span className="font-semibold text-[#001B40]">{fmtMinutes(g.totalMinutes)}</span>
                  </span>
                  <span className="text-[#576981]">
                    Revenue: <span className="font-semibold text-[#001B40]">{formatCurrency(g.totalRevenue, currency, { includeCode: false })}</span>
                  </span>
                </div>
              </div>
              <table className="w-full border-x border-b border-[#E1E6EB]">
                <thead>
                  <tr className="border-b border-[#E1E6EB]">
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Date</th>
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Team Member</th>
                    <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Description</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Hours</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Rate</th>
                    <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((e) => (
                    <tr key={e.id} className="border-b border-[#E1E6EB]">
                      <td className="px-4 py-1 text-sm">{formatDate(e.date)}</td>
                      <td className="px-4 py-1 text-sm">
                        {e.teamMember ? `${e.teamMember.firstName} ${e.teamMember.lastName}`.trim() : 'Unassigned'}
                      </td>
                      <td className="px-4 py-1 text-sm text-[#576981] max-w-[280px] truncate">
                        {e.description}
                      </td>
                      <td className="px-4 py-1 text-sm text-right">{fmtMinutes(e.durationMinutes)}</td>
                      <td className="px-4 py-1 text-sm text-right">
                        {e.rate ? formatCurrency(Number(e.rate), currency, { includeCode: false }) : '—'}
                      </td>
                      <td className="px-4 py-1 text-sm text-right font-semibold">
                        {e.rate
                          ? formatCurrency((e.durationMinutes / 60) * Number(e.rate), currency, { includeCode: false })
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </ReportLayout>
  )
}
