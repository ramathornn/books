'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import StatusBadge from '@/components/ui/StatusBadge'
import AdvancedEstimateSearchPanel, {
  AdvancedEstimateFilters,
} from './AdvancedEstimateSearchPanel'

export interface EstimateRow {
  id: string
  estimateNumber: string
  status: string
  currency: string
  dateIssued: string
  description: string
  total: number
  client: {
    firstName: string
    lastName: string
    organization: string
  }
}

export interface ListPayload {
  rows: EstimateRow[]
  totalCount: number
  totalPages: number
  perPage: number
  page: number
  sortBy: 'date' | 'amount' | 'client'
  sortDir: 'asc' | 'desc'
}

interface QueryState {
  page: number
  perPage: number
  search: string
  sortBy: 'date' | 'amount' | 'client'
  sortDir: 'asc' | 'desc'
  advanced: AdvancedEstimateFilters
}

function stateToParams(s: QueryState): URLSearchParams {
  const p = new URLSearchParams()
  if (s.page !== 1) p.set('page', String(s.page))
  if (s.perPage !== 30) p.set('perPage', String(s.perPage))
  if (s.search) p.set('search', s.search)
  if (s.sortBy !== 'date') p.set('sortBy', s.sortBy)
  if (s.sortDir !== 'desc') p.set('sort', s.sortDir)
  const a = s.advanced
  if (a.status) p.set('status', a.status)
  if (a.clientId) p.set('clientId', a.clientId)
  if (a.dateIssuedFrom) p.set('dateIssuedFrom', a.dateIssuedFrom)
  if (a.dateIssuedTo) p.set('dateIssuedTo', a.dateIssuedTo)
  if (a.amountMin) p.set('amountMin', a.amountMin)
  if (a.amountMax) p.set('amountMax', a.amountMax)
  if (a.currency) p.set('currency', a.currency)
  if (a.keyword) p.set('keyword', a.keyword)
  return p
}

function advancedKey(a: AdvancedEstimateFilters): string {
  return [
    a.status,
    a.clientId,
    a.dateIssuedFrom,
    a.dateIssuedTo,
    a.amountMin,
    a.amountMax,
    a.currency,
    a.keyword,
  ].join('|')
}

function statusBorder(status: string) {
  if (status === 'viewed') return '3px solid #F5B844'
  if (status === 'declined') return '3px solid #C93E57'
  if (status === 'accepted') return '3px solid #2FA84F'
  return undefined
}

function formatDate(d: string | Date) {
  const dt = new Date(d)
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  const yyyy = dt.getFullYear()
  return `${mm}/${dd}/${yyyy}`
}

export default function EstimatesListSection({
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

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const params = stateToParams(state)
    window.history.replaceState(
      {},
      '',
      `/estimates${params.toString() ? `?${params}` : ''}`
    )
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await fetch(`/api/estimates/table?${params.toString()}`, {
          cache: 'no-store',
        })
        if (res.ok) setData((await res.json()) as ListPayload)
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
    advancedKey(state.advanced),
  ])

  function setSort(field: 'date' | 'amount' | 'client') {
    setState((s) =>
      s.sortBy === field
        ? { ...s, sortDir: s.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...s, sortBy: field, sortDir: 'desc', page: 1 }
    )
  }

  return (
    <>
      {/* Search + Advanced Search */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
        <h2 className="text-base font-semibold text-[#001B40]">
          All Estimates and Proposals
        </h2>
        <div className="flex items-center gap-3 flex-wrap" data-print="hide">
          {selected.size > 0 && (
            <a
              href={`/api/estimates/pdf/bulk?ids=${Array.from(selected).join(',')}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 px-3 h-9 rounded-full bg-[#2FA84F] text-white text-sm font-medium hover:bg-[#268f3e]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF ({selected.size})
            </a>
          )}
          <div className="w-full sm:w-[260px]">
            <SearchPill
              value={state.search}
              onChange={(v) =>
                setState((s) => ({ ...s, search: v, page: 1 }))
              }
              placeholder="Search"
            />
          </div>
          <AdvancedEstimateSearchPanel
            filters={state.advanced}
            onApply={(advanced) =>
              setState((s) => ({ ...s, advanced, page: 1 }))
            }
          />
        </div>
      </div>

      <div className={loading ? 'opacity-60 transition-opacity' : ''}>
        {/* Mobile card list */}
        <ul className="sm:hidden -mx-4 border-t border-b border-[#E1E6EB] divide-y divide-[#E1E6EB]">
          {data.rows.length === 0 ? (
            <li className="px-4 py-12 text-center text-sm text-[#576981]">No estimates found.</li>
          ) : (
            data.rows.map((est) => {
              const displayName =
                est.client.organization ||
                `${est.client.firstName} ${est.client.lastName}`.trim()
              const href = `/estimates/${est.id}`
              return (
                <li
                  key={est.id}
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey) {
                      window.open(href, '_blank')
                    } else {
                      router.push(href)
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) window.open(href, '_blank')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') router.push(href)
                  }}
                  className="px-4 py-1 cursor-pointer hover:bg-[#F5F7FA] flex items-start gap-3"
                  style={
                    statusBorder(est.status)
                      ? { borderLeft: statusBorder(est.status) }
                      : undefined
                  }
                >
                  <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      style={{ width: 22, height: 22 }}
                      aria-label={`Select ${displayName}`}
                      checked={selected.has(est.id)}
                      onChange={() => toggleOne(est.id)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-medium text-[#001B40] truncate">
                          {displayName}
                        </div>
                        <div className="text-[13px] text-[#576981] mt-0.5">
                          {est.estimateNumber}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[15px] font-medium text-[#001B40] whitespace-nowrap">
                          {formatCurrency(est.total, est.currency, { includeCode: false })}{' '}
                          <span className="text-[11px] text-[#576981]">{est.currency}</span>
                        </div>
                        <div className="mt-1 flex justify-end">
                          <StatusBadge status={est.status} />
                        </div>
                      </div>
                    </div>
                    {est.description && (
                      <div className="text-[13px] text-[#576981] truncate mt-1">{est.description}</div>
                    )}
                    <div className="mt-2 text-[12px] text-[#576981]">{formatDate(est.dateIssued)}</div>
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
                <SortBtn
                  active={state.sortBy === 'client'}
                  dir={state.sortDir}
                  onClick={() => setSort('client')}
                  label="Client / Number"
                />
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                Description
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                <SortBtn
                  active={state.sortBy === 'date'}
                  dir={state.sortDir}
                  onClick={() => setSort('date')}
                  label="Date"
                />
              </th>
              <th className="px-4 py-1 text-right text-xs font-normal text-[#576981]">
                <SortBtn
                  active={state.sortBy === 'amount'}
                  dir={state.sortDir}
                  onClick={() => setSort('amount')}
                  label="Amount / Status"
                  align="right"
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E1E6EB]">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-[#576981]">
                  No estimates found.
                </td>
              </tr>
            ) : (
              data.rows.map((est) => {
                const displayName =
                  est.client.organization ||
                  `${est.client.firstName} ${est.client.lastName}`.trim()
                const href = `/estimates/${est.id}`
                return (
                  <tr
                    key={est.id}
                    role="link"
                    tabIndex={0}
                    onClick={(e) => {
                      if (e.metaKey || e.ctrlKey || e.shiftKey) {
                        window.open(href, '_blank')
                      } else {
                        router.push(href)
                      }
                    }}
                    onAuxClick={(e) => {
                      if (e.button === 1) window.open(href, '_blank')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') router.push(href)
                    }}
                    className="table-row-hover cursor-pointer"
                    style={
                      statusBorder(est.status)
                        ? { borderLeft: statusBorder(est.status) }
                        : undefined
                    }
                  >
                    <td className="pl-4 pr-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        style={{ width: 25, height: 25 }}
                        aria-label={`Select ${displayName}`}
                        checked={selected.has(est.id)}
                        onChange={() => toggleOne(est.id)}
                      />
                    </td>
                    <td className="px-4 py-1">
                      <div className="text-[16px] font-medium text-[#001B40] leading-tight">
                        {displayName}
                      </div>
                      <div className="text-[14px] text-[#576981] mt-0.5">
                        {est.estimateNumber}
                      </div>
                    </td>
                    <td className="px-4 py-1 text-[14px] text-[#001B40] truncate max-w-[320px]">
                      {est.description || '-'}
                    </td>
                    <td className="px-4 py-1 text-[14px] text-[#001B40]">
                      {formatDate(est.dateIssued)}
                    </td>
                    <td className="px-4 py-1 text-right">
                      <div className="text-[16px] font-medium text-[#001B40]">
                        {formatCurrency(est.total, est.currency, {
                          includeCode: false,
                        })}{' '}
                        <span className="text-[12px] font-normal text-[#576981]">
                          {est.currency}
                        </span>
                      </div>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={est.status} />
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
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

function SortBtn({
  active,
  dir,
  onClick,
  label,
  align,
}: {
  active: boolean
  dir: 'asc' | 'desc'
  onClick: () => void
  label: string
  align?: 'right'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 hover:text-[#0075DD] ${
        active ? 'font-semibold text-[#001B40]' : 'text-[#576981]'
      } ${align === 'right' ? 'ml-auto' : ''}`}
    >
      {label}
      {active && (
        <svg
          className={`w-3 h-3 text-[#0075DD] transition-transform ${
            dir === 'desc' ? 'rotate-180' : ''
          }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7 14l5-5 5 5z" />
        </svg>
      )}
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
        <svg className="h-4 w-4 text-[#8C9BAB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
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
    <div className="flex items-center justify-center gap-1 py-3 text-sm" data-print="hide">
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
