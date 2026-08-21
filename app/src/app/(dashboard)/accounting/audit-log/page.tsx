export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import type { Prisma } from '@/generated/prisma/client'

export const metadata: Metadata = { title: 'Audit Log' }

const PAGE_SIZE = 50

const ACTION_COLORS: Record<string, string> = {
  create: '#216E39',
  update: '#0075DD',
  delete: '#BF2600',
  post: '#216E39',
  void: '#BF2600',
  reverse: '#BF2600',
  categorize: '#0075DD',
  match: '#0075DD',
  reconcile: '#216E39',
  finish: '#216E39',
  exclude: '#996B00',
  unpost: '#BF2600',
  run: '#0075DD',
  lock: '#996B00',
  unlock: '#BF2600',
  pay: '#216E39',
  archive: '#576981',
}

// Known entity types and actions for the filter dropdowns. Kept in sync with
// src/lib/audit.ts. Append-only data — these are just for filtering.
const ENTITY_TYPES = [
  'invoice',
  'bill',
  'expense',
  'journal_entry',
  'bank_transaction',
  'gl_account',
  'tax_return',
  'reconciliation',
  'period_lock',
  'recurring_template',
  'vendor',
  'mileage',
]

const ACTIONS = [
  'create',
  'update',
  'delete',
  'post',
  'void',
  'reverse',
  'categorize',
  'match',
  'reconcile',
  'finish',
  'exclude',
  'unpost',
  'run',
  'lock',
  'unlock',
  'pay',
  'archive',
]

// Build a link to the entity's detail page where one exists. Returns null when
// the entity has no standalone view (e.g. bank transactions live under their
// account, period locks have no detail page).
function entityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'invoice':
      return `/invoices/${entityId}`
    case 'bill':
      return `/bills/${entityId}`
    case 'expense':
      return `/expenses/${entityId}`
    case 'journal_entry':
      return `/accounting/journal-entries/${entityId}`
    case 'gl_account':
      return `/accounting/chart-of-accounts/${entityId}/history`
    case 'vendor':
      return `/vendors/${entityId}`
    default:
      return null
  }
}

function label(s: string) {
  return s.replace(/_/g, ' ')
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const entityType = typeof sp.entityType === 'string' ? sp.entityType : ''
  const action = typeof sp.action === 'string' ? sp.action : ''
  const from = typeof sp.from === 'string' ? sp.from : ''
  const to = typeof sp.to === 'string' ? sp.to : ''
  const pageRaw = typeof sp.page === 'string' ? parseInt(sp.page, 10) : 1
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

  const where: Prisma.AuditLogWhereInput = {}
  if (entityType) where.entityType = entityType
  if (action) where.action = action

  // Date range filters on createdAt. `to` is inclusive of the whole day.
  const createdAt: Prisma.DateTimeFilter<'AuditLog'> = {}
  if (from) {
    const d = new Date(`${from}T00:00:00`)
    if (!Number.isNaN(d.getTime())) createdAt.gte = d
  }
  if (to) {
    const d = new Date(`${to}T23:59:59.999`)
    if (!Number.isNaN(d.getTime())) createdAt.lte = d
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt

  const [total, entries] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters = !!(entityType || action || from || to)

  // Build pagination hrefs that preserve the active filters.
  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    if (entityType) params.set('entityType', entityType)
    if (action) params.set('action', action)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    if (p > 1) params.set('page', String(p))
    const qs = params.toString()
    return qs ? `/accounting/audit-log?${qs}` : '/accounting/audit-log'
  }

  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const end = Math.min(page * PAGE_SIZE, total)

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting" className="text-[#0075DD] hover:underline">← Accounting</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Audit Log
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          An append-only record of who did what and when across every transaction. Newest first.
        </p>
      </div>

      {/* Filters */}
      <form
        method="get"
        className="bg-white rounded-lg border border-[#E1E6EB] p-4 mb-4 flex flex-wrap items-end gap-3"
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#576981]">Entity type</label>
          <select
            name="entityType"
            defaultValue={entityType}
            className="border border-[#E1E6EB] rounded px-2 py-1.5 text-sm text-[#001B40] bg-white min-w-[150px]"
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#576981]">Action</label>
          <select
            name="action"
            defaultValue={action}
            className="border border-[#E1E6EB] rounded px-2 py-1.5 text-sm text-[#001B40] bg-white min-w-[130px]"
          >
            <option value="">All</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#576981]">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="border border-[#E1E6EB] rounded px-2 py-1.5 text-sm text-[#001B40] bg-white"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-[#576981]">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to}
            className="border border-[#E1E6EB] rounded px-2 py-1.5 text-sm text-[#001B40] bg-white"
          />
        </div>

        <button
          type="submit"
          className="px-4 py-1.5 text-sm font-medium text-white bg-[#0075DD] rounded hover:bg-[#0061b8]"
        >
          Apply
        </button>
        {hasFilters && (
          <Link
            href="/accounting/audit-log"
            className="px-4 py-1.5 text-sm font-medium text-[#576981] border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-[#576981]">
          {total === 0 ? 'No entries' : `Showing ${start}–${end} of ${total}`}
        </p>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        {entries.length === 0 ? (
          <div className="p-12 text-center text-sm text-[#576981]">
            {hasFilters
              ? 'No audit entries match these filters.'
              : "No audit entries yet. As you create, edit, post, and reconcile, they'll appear here."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">When</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Who</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Action</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Entity</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Summary</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const href = entityHref(e.entityType, e.entityId)
                  return (
                    <tr key={e.id} className="border-t border-[#E1E6EB]">
                      <td className="px-3 py-2 text-xs text-[#576981] whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#001B40]">{e.userName || '—'}</td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
                          style={{
                            backgroundColor: '#F5F7FA',
                            color: ACTION_COLORS[e.action] || '#576981',
                          }}
                        >
                          {e.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-[#576981]">
                        {href ? (
                          <Link href={href} className="hover:underline text-[#0075DD]">
                            <span className="font-mono">{e.entityType}</span>
                            <span className="text-[#8C9BAB]"> / {e.entityId.slice(0, 8)}</span>
                          </Link>
                        ) : (
                          <>
                            <span className="font-mono">{e.entityType}</span>
                            <span className="text-[#8C9BAB]"> / {e.entityId.slice(0, 8)}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#001B40]">{e.summary || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          {page > 1 ? (
            <Link
              href={pageHref(page - 1)}
              className="px-3 py-1.5 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              ← Previous
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-sm font-medium text-[#8C9BAB] bg-white border border-[#E1E6EB] rounded cursor-default">
              ← Previous
            </span>
          )}
          <span className="text-xs text-[#576981]">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={pageHref(page + 1)}
              className="px-3 py-1.5 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              Next →
            </Link>
          ) : (
            <span className="px-3 py-1.5 text-sm font-medium text-[#8C9BAB] bg-white border border-[#E1E6EB] rounded cursor-default">
              Next →
            </span>
          )}
        </div>
      )}
    </div>
  )
}
