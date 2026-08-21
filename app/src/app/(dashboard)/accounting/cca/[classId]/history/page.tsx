export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { buildClassSchedule } from '@/lib/cca/service'

const money = (n: number) => formatCurrency(n, 'CAD', { includeCode: false })

export default async function CcaHistoryPage({
  params,
}: {
  params: Promise<{ classId: string }>
}) {
  const { classId } = await params

  const schedule = await buildClassSchedule(classId)
  if (!schedule) return notFound()

  const jeIds = schedule.years.map((y) => y.journalEntryId).filter((x): x is string => !!x)
  const jes = jeIds.length
    ? await prisma.journalEntry.findMany({
        where: { id: { in: jeIds } },
        select: { id: true, entryNumber: true },
      })
    : []
  const jeMap = new Map(jes.map((j) => [j.id, j.entryNumber]))

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting/cca" className="text-[#0075DD] hover:underline">← Capital Cost Allowance</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Class {schedule.class.classNumber} — history
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          {schedule.class.description} · {(schedule.class.rate * 100).toFixed(2)}%. Filed years show the
          frozen as-filed snapshot; open years show the live recompute. Posted years link their journal
          entry.
        </p>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-x-auto">
        <table className="w-full text-sm min-w-[940px]">
          <thead className="bg-[#F5F7FA]">
            <tr>
              {['Year', 'Status', 'Opening UCC', 'Additions', 'Dispositions', 'CCA claimed', 'Closing UCC', 'As filed (CCA)', 'JE'].map((h, i) => (
                <th key={i} className={`px-3 py-2 text-xs font-semibold text-[#576981] ${i <= 1 || i === 8 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedule.years.map((y) => (
              <tr key={y.taxYear} className={`border-t border-[#E1E6EB] ${y.locked ? 'bg-[#FAFBFC]' : ''}`}>
                <td className="px-3 py-2 font-mono text-[#001B40]">
                  {y.taxYear}
                  {y.isCatchUp && <span className="ml-1 text-[10px] text-[#8B5A00]">catch-up</span>}
                  {y.isSeed && <span className="ml-1 text-[10px] text-[#576981]">seed</span>}
                </td>
                <td className="px-3 py-2">
                  {y.locked ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#EEF1F4] text-[#576981]">locked</span>
                  ) : y.journalEntryId ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#E3FCEF] text-[#006644]">posted</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-[#FFF7E6] text-[#8B5A00]">draft</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">{money(y.openingUcc)}</td>
                <td className="px-3 py-2 text-right font-mono">{y.additions ? money(y.additions) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono">{y.dispositions ? money(y.dispositions) : '—'}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold">{money(y.ccaClaimed)}</td>
                <td className={`px-3 py-2 text-right font-mono ${y.recapture ? 'text-[#BF2600]' : ''}`}>{money(y.closingUcc)}</td>
                <td className="px-3 py-2 text-right font-mono text-[#576981]">
                  {y.filedCcaClaimed != null ? money(y.filedCcaClaimed) : '—'}
                </td>
                <td className="px-3 py-2">
                  {y.journalEntryId ? (
                    <Link href={`/accounting/journal-entries/${y.journalEntryId}`} className="text-xs text-[#0075DD] hover:underline font-mono">
                      {jeMap.get(y.journalEntryId) ?? 'JE'}
                    </Link>
                  ) : (
                    <span className="text-xs text-[#576981]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
