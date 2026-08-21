export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import PrimaryButton from '@/components/ui/PrimaryButton'
import StatusBadge from '@/components/ui/StatusBadge'

export const metadata: Metadata = { title: 'Journal Entries' }

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'posted', label: 'Posted' },
] as const

const DOC_FILTERS = [
  { value: '', label: 'All' },
  { value: 'with', label: 'With document' },
  { value: 'without', label: 'No document' },
] as const

function jeListHref(params: { status?: string; docs?: string }) {
  const p = new URLSearchParams()
  if (params.status) p.set('status', params.status)
  if (params.docs) p.set('docs', params.docs)
  const s = p.toString()
  return s ? `/accounting/journal-entries?${s}` : '/accounting/journal-entries'
}

export default async function JournalEntriesPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const statusParam = typeof sp.status === 'string' ? sp.status : ''
  const status = statusParam === 'draft' || statusParam === 'posted' ? statusParam : ''
  const docsParam = typeof sp.docs === 'string' ? sp.docs : ''
  const docs = docsParam === 'with' || docsParam === 'without' ? docsParam : ''

  // Attachments use a generic table keyed by entityType/entityId (no Prisma
  // relation), so resolve the JE ids that have a live document separately.
  const attachedRows = await prisma.attachment.findMany({
    where: { entityType: 'journal_entry', isArchived: false },
    select: { entityId: true },
    distinct: ['entityId'],
  })
  const attachedIds = attachedRows.map((a) => a.entityId)
  const attachedSet = new Set(attachedIds)

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (docs === 'with') where.id = { in: attachedIds }
  else if (docs === 'without') where.id = { notIn: attachedIds }

  const entries = await prisma.journalEntry.findMany({
    where,
    orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
    include: { lines: true },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/accounting" className="text-xs text-[#0075DD] hover:underline">
            Accounting
          </Link>
          <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
            Journal Entries
          </h1>
        </div>
        <PrimaryButton href="/accounting/journal-entries/new">New Journal Entry</PrimaryButton>
      </div>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-1">
          {STATUS_FILTERS.map((f) => {
            const active = status === f.value
            return (
              <Link
                key={f.value || 'all'}
                href={jeListHref({ status: f.value, docs })}
                className={`px-3 py-1 text-sm rounded border ${
                  active
                    ? 'bg-[#001B40] text-white border-[#001B40]'
                    : 'bg-white text-[#576981] border-[#E1E6EB] hover:bg-[#F5F7FA]'
                }`}
              >
                {f.label}
              </Link>
            )
          })}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-[#8C9BAB] mr-1">Documents</span>
          {DOC_FILTERS.map((f) => {
            const active = docs === f.value
            return (
              <Link
                key={f.value || 'all'}
                href={jeListHref({ status, docs: f.value })}
                className={`px-3 py-1 text-sm rounded border ${
                  active
                    ? 'bg-[#001B40] text-white border-[#001B40]'
                    : 'bg-white text-[#576981] border-[#E1E6EB] hover:bg-[#F5F7FA]'
                }`}
              >
                {f.label}
              </Link>
            )
          })}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Entry # / Date</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Description</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Debit Total</th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Credit Total</th>
              <th className="px-4 py-1 text-center text-xs font-semibold text-[#576981] w-16">Docs</th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-[#576981]">
                  No journal entries yet.
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                  <td className="px-4 py-1 text-sm">
                    <Link
                      href={`/accounting/journal-entries/${e.id}`}
                      className="text-[#0075DD] hover:underline"
                    >
                      {e.entryNumber}
                    </Link>
                    <div className="text-xs text-[#576981]">{formatDate(e.entryDate)}</div>
                  </td>
                  <td className="px-4 py-1 text-sm text-[#001B40]">
                    {e.description || '—'}
                  </td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                    {formatCurrency(Number(e.totalDebit), 'CAD', { includeCode: false })}
                  </td>
                  <td className="px-4 py-1 text-sm text-right text-[#001B40]">
                    {formatCurrency(Number(e.totalCredit), 'CAD', { includeCode: false })}
                  </td>
                  <td className="px-4 py-1 text-center">
                    {attachedSet.has(e.id) ? (
                      <span title="Has source document" className="text-[#0075DD]">📎</span>
                    ) : (
                      <span className="text-[#C7CFD8]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-1">
                    <StatusBadge status={e.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
