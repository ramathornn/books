'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import Pagination from '@/components/ui/Pagination'
import AdvancedSearchPanel, {
  AdvancedFilters,
} from './AdvancedSearchPanel'

type SortBy = 'name' | 'contact' | 'outstanding' | 'draft'

export interface ListRow {
  id: string
  firstName: string
  lastName: string
  organization: string
  internalNote: string
  currency: string
  outstandingByCurrency: Record<string, number>
  draftByCurrency: Record<string, number>
}

export interface ListPayload {
  rows: ListRow[]
  totalCount: number
  totalPages: number
  perPage: number
  page: number
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  totals: [string, number][]
}

interface QueryState {
  page: number
  perPage: number
  search: string
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  filters: AdvancedFilters
}

function stateToParams(s: QueryState): URLSearchParams {
  const p = new URLSearchParams()
  if (s.page !== 1) p.set('page', String(s.page))
  if (s.perPage !== 50) p.set('perPage', String(s.perPage))
  if (s.search) p.set('search', s.search)
  if (s.sortBy !== 'outstanding') p.set('sortBy', s.sortBy)
  const defaultDir: 'asc' | 'desc' =
    s.sortBy === 'outstanding' || s.sortBy === 'draft' ? 'desc' : 'asc'
  if (s.sortDir !== defaultDir) p.set('sort', s.sortDir)
  if (s.filters.company) p.set('company', s.filters.company)
  if (s.filters.contact) p.set('contact', s.filters.contact)
  if (s.filters.email) p.set('email', s.filters.email)
  if (s.filters.keyword) p.set('keyword', s.filters.keyword)
  if (s.filters.field && s.filters.field !== 'all')
    p.set('field', s.filters.field)
  return p
}

export default function ClientsListSection({
  initial,
  initialState,
}: {
  initial: ListPayload
  initialState: QueryState
}) {
  const router = useRouter()
  const [state, setState] = useState<QueryState>(initialState)
  const [data, setData] = useState<ListPayload>(initial)
  const [loading, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstRun = useRef(true)

  const allSelected = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id))
  const someSelected = !allSelected && data.rows.some((r) => selected.has(r.id))

  function toggleAll() {
    setSelected((prev) => {
      if (data.rows.every((r) => prev.has(r.id))) {
        const next = new Set(prev)
        data.rows.forEach((r) => next.delete(r.id))
        return next
      }
      const next = new Set(prev)
      data.rows.forEach((r) => next.add(r.id))
      return next
    })
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Re-fetch from API when state changes; update URL via history (no page reload)
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const params = stateToParams(state)
    const url = `/clients${params.toString() ? `?${params}` : ''}`
    window.history.replaceState({}, '', url)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await fetch(`/api/clients/table?${params.toString()}`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const json = (await res.json()) as ListPayload
          setData(json)
        }
      })
    }, 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.page,
    state.perPage,
    state.search,
    state.sortBy,
    state.sortDir,
    state.filters.company,
    state.filters.contact,
    state.filters.email,
    state.filters.keyword,
    state.filters.field,
  ])

  function setSort(field: SortBy) {
    setState((s) => {
      if (s.sortBy === field) {
        return { ...s, sortDir: s.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }
      }
      const newDefaultDir: 'asc' | 'desc' =
        field === 'outstanding' || field === 'draft' ? 'desc' : 'asc'
      return { ...s, sortBy: field, sortDir: newDefaultDir, page: 1 }
    })
  }

  function setSearch(v: string) {
    setState((s) => ({ ...s, search: v, page: 1 }))
  }

  function applyFilters(f: AdvancedFilters) {
    setState((s) => ({ ...s, filters: f, page: 1 }))
  }

  function setPerPage(n: number) {
    setState((s) => ({ ...s, perPage: n, page: 1 }))
  }

  return (
    <>
      {/* Sub-heading + search + advanced search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
        <h2 className="text-base font-semibold text-[#001B40]">
          All Clients{' '}
          <span className="font-normal text-[#576981]">({data.totalCount})</span>
        </h2>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-full sm:w-[260px]">
            <SearchPill
              value={state.search}
              onChange={setSearch}
              placeholder="Search"
            />
          </div>
          <AdvancedSearchPanel
            filters={state.filters}
            onApply={applyFilters}
          />
        </div>
      </div>

      {/* Table */}
      <div className={loading ? 'opacity-60 transition-opacity' : ''}>
        {/* Mobile card list */}
        <ul className="sm:hidden -mx-4 border-t border-b border-[#E1E6EB] divide-y divide-[#E1E6EB]">
          {data.rows.length === 0 ? (
            <li className="px-4 py-12 text-center text-sm text-[#576981]">No clients found.</li>
          ) : (
            data.rows.map((c) => {
              const outstandingEntries = Object.entries(c.outstandingByCurrency).filter(
                ([, amt]) => amt > 0
              )
              const totalOutstanding = outstandingEntries.reduce((s, [, v]) => s + v, 0)
              const outstandingCurrency =
                outstandingEntries[0]?.[0] || c.currency || 'CAD'
              const draftEntries = Object.entries(c.draftByCurrency || {}).filter(
                ([, amt]) => amt > 0
              )
              const totalDraft = draftEntries.reduce((s, [, v]) => s + v, 0)
              const draftCurrency = draftEntries[0]?.[0] || c.currency || 'CAD'
              const displayName =
                c.organization || `${c.firstName} ${c.lastName}`.trim()
              return (
                <li
                  key={c.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/clients/${c.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') router.push(`/clients/${c.id}`)
                  }}
                  className="px-4 py-1 cursor-pointer hover:bg-[#F5F7FA] flex items-start gap-3"
                >
                  <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      style={{ width: 22, height: 22 }}
                      aria-label={`Select ${displayName}`}
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-medium text-[#001B40] truncate">
                      {displayName}
                    </div>
                    {c.organization && (c.firstName || c.lastName) && (
                      <div className="text-[13px] text-[#576981] mt-0.5 truncate">
                        {`${c.firstName} ${c.lastName}`.trim()}
                      </div>
                    )}
                    {c.internalNote && (
                      <div className="text-[13px] text-[#576981] truncate mt-1">{c.internalNote}</div>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-[#576981]">
                        Outstanding{' '}
                        <span className="text-[#0075DD] font-medium">
                          {formatCurrency(totalOutstanding, outstandingCurrency, { includeCode: false })}
                        </span>{' '}
                        <span className="text-[11px] text-[#576981]">{outstandingCurrency}</span>
                      </span>
                      <span className="text-[#576981]">
                        Draft{' '}
                        <span className="text-[#001B40] font-medium">
                          {formatCurrency(totalDraft, draftCurrency, { includeCode: false })}
                        </span>{' '}
                        <span className="text-[11px] text-[#576981]">{draftCurrency}</span>
                      </span>
                    </div>
                  </div>
                </li>
              )
            })
          )}
        </ul>

        {/* Desktop table */}
        <div className="hidden sm:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="pl-4 pr-2 py-1 text-left w-10">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  style={{ width: 25, height: 25 }}
                  aria-label="Select all"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                <SortToggle
                  sortBy={state.sortBy}
                  sortDir={state.sortDir}
                  onSort={setSort}
                />
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                Internal Note
              </th>
              <th className="px-4 py-1 text-right text-xs font-normal text-[#576981]">
                Credit
              </th>
              <th className="px-4 py-1 text-right text-xs font-normal text-[#576981]">
                <AmountSortHeader
                  label="Total Outstanding"
                  field="outstanding"
                  sortBy={state.sortBy}
                  sortDir={state.sortDir}
                  onSort={setSort}
                />
              </th>
              <th className="px-4 py-1 text-right text-xs font-normal text-[#576981]">
                <AmountSortHeader
                  label="Total in Draft"
                  field="draft"
                  sortBy={state.sortBy}
                  sortDir={state.sortDir}
                  onSort={setSort}
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E1E6EB]">
            {data.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-[#576981]"
                >
                  No clients found.
                </td>
              </tr>
            ) : (
              data.rows.map((c) => (
                <Row
                  key={c.id}
                  client={c}
                  router={router}
                  selected={selected.has(c.id)}
                  onToggle={() => toggleOne(c.id)}
                />
              ))
            )}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr className="bg-[#F5F7FA] border-t border-[#E1E6EB]">
                <td
                  colSpan={4}
                  className="px-4 py-1 align-top text-sm text-[#001B40] text-right"
                >
                  Totals:
                </td>
                <td className="px-4 py-1 align-top text-sm text-[#001B40] text-right">
                  <div className="space-y-0.5">
                    {data.totals.map(([c, amt]) => (
                      <div key={c}>
                        {formatCurrency(amt, c, { includeCode: false })}{' '}
                        <span className="text-xs text-[#576981]">{c}</span>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-1 align-top text-sm text-[#001B40] text-right">
                  <div className="space-y-0.5">
                    {Object.entries(
                      data.rows.reduce<Record<string, number>>((acc, r) => {
                        for (const [c, amt] of Object.entries(
                          r.draftByCurrency || {}
                        )) {
                          acc[c] = (acc[c] || 0) + amt
                        }
                        return acc
                      }, {})
                    )
                      .sort((a, b) => b[1] - a[1])
                      .map(([c, amt]) => (
                        <div key={c}>
                          {formatCurrency(amt, c, { includeCode: false })}{' '}
                          <span className="text-xs text-[#576981]">{c}</span>
                        </div>
                      ))}
                  </div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
        </div>

        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-sm text-[#576981]">Show</span>
          <div className="flex gap-1">
            {[25, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setPerPage(n)}
                className={`px-2 py-1 text-xs rounded ${
                  state.perPage === n
                    ? 'bg-[#0075DD] text-white'
                    : 'bg-gray-100 text-[#576981] hover:bg-gray-200'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="text-sm text-[#576981]">per page</span>
          <span className="ml-auto text-sm text-[#576981]">
            {data.totalCount} {data.totalCount === 1 ? 'client' : 'clients'} total
          </span>
        </div>

        <PaginationLocal
          page={state.page}
          totalPages={data.totalPages}
          onPage={(n) => setState((s) => ({ ...s, page: n }))}
        />
      </div>
    </>
  )
}

function Row({
  client,
  router,
  selected,
  onToggle,
}: {
  client: ListRow
  router: ReturnType<typeof useRouter>
  selected: boolean
  onToggle: () => void
}) {
  const outstandingEntries = Object.entries(client.outstandingByCurrency).filter(
    ([, amt]) => amt > 0
  )
  const totalOutstanding = outstandingEntries.reduce((s, [, v]) => s + v, 0)
  const outstandingCurrency =
    outstandingEntries[0]?.[0] || client.currency || 'CAD'

  const draftEntries = Object.entries(client.draftByCurrency || {}).filter(
    ([, amt]) => amt > 0
  )
  const totalDraft = draftEntries.reduce((s, [, v]) => s + v, 0)
  const draftCurrency = draftEntries[0]?.[0] || client.currency || 'CAD'

  const displayName =
    client.organization || `${client.firstName} ${client.lastName}`.trim()

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/clients/${client.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') router.push(`/clients/${client.id}`)
      }}
      className="table-row-hover cursor-pointer"
    >
      <td className="pl-4 pr-2 py-1" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-gray-300"
          style={{ width: 25, height: 25 }}
          aria-label={`Select ${displayName}`}
          checked={selected}
          onChange={onToggle}
        />
      </td>
      <td className="px-4 py-1">
        <div className="text-[16px] font-medium text-[#001B40] leading-tight">
          {displayName}
        </div>
        {client.organization && (client.firstName || client.lastName) && (
          <div className="text-[14px] text-[#576981] mt-0.5">
            {`${client.firstName} ${client.lastName}`.trim()}
          </div>
        )}
      </td>
      <td className="px-4 py-1 text-[14px] text-[#576981] truncate max-w-[280px]">
        {client.internalNote || ''}
      </td>
      <td className="px-4 py-1 text-[14px] text-[#576981] text-right" />
      <td className="px-4 py-1 text-[14px] text-right">
        <div className="inline-flex items-center justify-end gap-3">
          <div
            className="row-actions inline-flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              title="Edit"
              onClick={() => router.push(`/clients/${client.id}/edit`)}
              className="text-[#576981] hover:text-[#0075DD]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button type="button" title="Archive" className="text-[#576981] hover:text-[#0075DD]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
              </svg>
            </button>
            <button type="button" title="Delete" className="text-[#576981] hover:text-[#C93E57]">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
          </div>
          <span>
            <span className="text-[16px] text-[#0075DD]">
              {formatCurrency(totalOutstanding, outstandingCurrency, {
                includeCode: false,
              })}
            </span>{' '}
            <span className="text-[12px] text-[#576981]">
              {outstandingCurrency}
            </span>
          </span>
        </div>
      </td>
      <td className="px-4 py-1 text-[14px] text-right">
        <span className="text-[16px] text-[#001B40]">
          {formatCurrency(totalDraft, draftCurrency, { includeCode: false })}
        </span>{' '}
        <span className="text-[12px] text-[#576981]">{draftCurrency}</span>
      </td>
    </tr>
  )
}

function SortArrow({ dir }: { dir: 'asc' | 'desc' }) {
  return (
    <svg
      className={`w-3 h-3 text-[#0075DD] transition-transform ${
        dir === 'desc' ? 'rotate-180' : ''
      }`}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M7 14l5-5 5 5z" />
    </svg>
  )
}

function SortToggle({
  sortBy,
  sortDir,
  onSort,
}: {
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  onSort: (f: SortBy) => void
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => onSort('name')}
        className={`inline-flex items-center gap-1 hover:text-[#0075DD] ${
          sortBy === 'name' ? 'font-semibold text-[#001B40]' : 'text-[#576981]'
        }`}
      >
        Client Name
        {sortBy === 'name' && <SortArrow dir={sortDir} />}
      </button>
      <span className="text-[#576981]">/</span>
      <button
        type="button"
        onClick={() => onSort('contact')}
        className={`inline-flex items-center gap-1 hover:text-[#0075DD] ${
          sortBy === 'contact'
            ? 'font-semibold text-[#001B40]'
            : 'text-[#576981]'
        }`}
      >
        Primary Contact
        {sortBy === 'contact' && <SortArrow dir={sortDir} />}
      </button>
    </span>
  )
}

function AmountSortHeader({
  label,
  field,
  sortBy,
  sortDir,
  onSort,
}: {
  label: string
  field: SortBy
  sortBy: SortBy
  sortDir: 'asc' | 'desc'
  onSort: (f: SortBy) => void
}) {
  const active = sortBy === field
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`inline-flex items-center gap-1 hover:text-[#0075DD] ${
        active ? 'font-semibold text-[#001B40]' : 'text-[#576981]'
      }`}
    >
      {label}
      {active && <SortArrow dir={sortDir} />}
    </button>
  )
}

function SearchPill({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg
          className="h-4 w-4 text-[#8C9BAB]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="block w-full pl-9 pr-3 h-9 border border-[#E1E6EB] rounded-full text-sm placeholder-[#8C9BAB] focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]"
      />
    </div>
  )
}

function PaginationLocal({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (n: number) => void
}) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-1 py-3 text-sm">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page === 1}
        className="px-3 py-1 text-[#0075DD] disabled:text-[#8C9BAB] disabled:cursor-not-allowed"
      >
        Prev
      </button>
      <span className="text-[#576981]">
        Page <span className="font-semibold text-[#001B40]">{page}</span> of{' '}
        {totalPages}
      </span>
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="px-3 py-1 text-[#0075DD] disabled:text-[#8C9BAB] disabled:cursor-not-allowed"
      >
        Next
      </button>
    </div>
  )
}
