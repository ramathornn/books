export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import { loadMissingAndOrphans, loadDuplicates } from '@/lib/receiptReconData'

export const metadata: Metadata = { title: 'Source Document Coverage — Reports' }

export default async function SourceDocumentsReport() {
  const [{ missing, orphans }, { groups, unreadable }] = await Promise.all([
    loadMissingAndOrphans(),
    loadDuplicates(),
  ])

  // Prioritise the gaps that legally need chasing: ITC-bearing first, then by amount.
  const missingSorted = [...missing].sort((a, b) => {
    if (a.itcBearing !== b.itcBearing) return a.itcBearing ? -1 : 1
    return b.amount - a.amount
  })

  const Card = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
    <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-x-auto mb-6">
      <div className="px-4 py-3 bg-[#F5F7FA] border-b border-[#E1E6EB] flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[#001B40]">{title}</h2>
        <span className="text-xs text-[#576981]">{count}</span>
      </div>
      {children}
    </div>
  )

  return (
    <div>
      <div className="mb-6">
        <Link href="/reports" className="text-xs text-[#0075DD] hover:underline">
          Reports
        </Link>
        <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Source Document Coverage
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Posted transactions missing a source document, orphaned files, and duplicates — for the
          audit trail from each transaction to its receipt.
        </p>
      </div>

      <Card title="Undocumented transactions" count={missingSorted.length}>
        {missingSorted.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#576981]">
            Every posted expense traces to a source document. 🎉
          </p>
        ) : (
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-[#FFFEFD] border-b border-[#E1E6EB]">
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Entry / Date</th>
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Account</th>
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Description</th>
                <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Amount</th>
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-24">Priority</th>
              </tr>
            </thead>
            <tbody>
              {missingSorted.map((m) => (
                <tr key={m.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                  <td className="px-4 py-1 text-sm">
                    <Link href={`/accounting/journal-entries/${m.id}`} className="text-[#0075DD] hover:underline">
                      {m.entryNumber}
                    </Link>
                    <div className="text-xs text-[#576981]">{m.date}</div>
                  </td>
                  <td className="px-4 py-1 text-sm text-[#001B40]">{m.account || '—'}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{m.description || '—'}</td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                    {formatCurrency(m.amount, 'CAD', { includeCode: false })}
                  </td>
                  <td className="px-4 py-1 text-xs">
                    {m.itcBearing && (
                      <span className="inline-block px-2 py-0.5 rounded bg-[#FDECEA] text-[#BF2600] mr-1">ITC</span>
                    )}
                    <span className="text-[#576981]">{m.amountTier}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Orphan files" count={orphans.length}>
        {orphans.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#576981]">No orphaned files.</p>
        ) : (
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="bg-[#FFFEFD] border-b border-[#E1E6EB]">
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">File</th>
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Folder</th>
              </tr>
            </thead>
            <tbody>
              {orphans.map((o) => (
                <tr key={o.id} className="border-t border-[#E1E6EB]">
                  <td className="px-4 py-1 text-sm text-[#001B40]">{o.name}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{o.folder || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Duplicate files" count={groups.length}>
        {groups.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[#576981]">No duplicate files.</p>
        ) : (
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="bg-[#FFFEFD] border-b border-[#E1E6EB]">
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Kept (canonical)</th>
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Duplicates</th>
                <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Hash</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.sha256} className="border-t border-[#E1E6EB]">
                  <td className="px-4 py-1 text-sm text-[#001B40]">{g.canonical.name}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">
                    {g.duplicates.map((d) => d.name).join(', ')}
                  </td>
                  <td className="px-4 py-1 text-xs text-[#576981] font-mono">{g.sha256.slice(0, 12)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {unreadable.length > 0 && (
        <p className="text-xs text-[#576981]">
          {unreadable.length} file(s) could not be read from disk and were skipped in the duplicate scan.
        </p>
      )}
    </div>
  )
}
