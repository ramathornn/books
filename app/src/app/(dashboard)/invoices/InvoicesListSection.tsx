'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  formatCurrency,
  formatInvoiceNumber,
  formatDate,
  formatDateLong,
} from '@/lib/utils'
import StatusBadge from '@/components/ui/StatusBadge'
import InvoiceRowActions from './InvoiceRowActions'
import AdvancedInvoiceSearchPanel, {
  AdvancedInvoiceFilters,
} from './AdvancedInvoiceSearchPanel'

export interface InvoiceRow {
  id: string
  invoiceNumber: string
  status: string
  currency: string
  dateIssued: string
  dateDue: string
  description: string
  total: number
  amountDue: number
  amountPaid: number
  paidDate?: string | null
  onlinePaymentsEnabled?: boolean
  client: {
    firstName: string
    lastName: string
    organization: string
  }
}

export interface ListPayload {
  rows: InvoiceRow[]
  totalCount: number
  totalPages: number
  perPage: number
  page: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  totals: [string, number][]
}

interface QueryState {
  page: number
  perPage: number
  search: string
  sortBy: 'dateIssued' | 'dateDue' | 'total' | 'invoiceNumber'
  sortDir: 'asc' | 'desc'
  advanced: AdvancedInvoiceFilters
}

function stateToParams(s: QueryState): URLSearchParams {
  const p = new URLSearchParams()
  if (s.page !== 1) p.set('page', String(s.page))
  if (s.perPage !== 50) p.set('perPage', String(s.perPage))
  if (s.search) p.set('search', s.search)
  if (s.sortBy !== 'dateIssued') p.set('sortBy', s.sortBy)
  if (s.sortDir !== 'desc') p.set('sort', s.sortDir)
  const a = s.advanced
  if (a.status) p.set('status', a.status)
  if (a.clientId) p.set('clientId', a.clientId)
  if (a.dateIssuedFrom) p.set('dateIssuedFrom', a.dateIssuedFrom)
  if (a.dateIssuedTo) p.set('dateIssuedTo', a.dateIssuedTo)
  if (a.dateDueFrom) p.set('dateDueFrom', a.dateDueFrom)
  if (a.dateDueTo) p.set('dateDueTo', a.dateDueTo)
  if (a.amountMin) p.set('amountMin', a.amountMin)
  if (a.amountMax) p.set('amountMax', a.amountMax)
  if (a.currency) p.set('currency', a.currency)
  if (a.keyword) p.set('keyword', a.keyword)
  return p
}

function advancedKey(a: AdvancedInvoiceFilters): string {
  return [
    a.status,
    a.clientId,
    a.dateIssuedFrom,
    a.dateIssuedTo,
    a.dateDueFrom,
    a.dateDueTo,
    a.amountMin,
    a.amountMax,
    a.currency,
    a.keyword,
  ].join('|')
}

// Invoice dates are stored at UTC midnight (calendar dates with no real time).
// Diff the due date's UTC calendar day against the viewer's local "today" so
// day labels and overdue logic don't drift a day in negative-offset zones.
function daysUntilDue(dateDue: string): number {
  const due = new Date(dateDue)
  if (isNaN(due.getTime())) return 0
  const dueDay = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((dueDay - today) / 86400000)
}

function effectiveStatus(status: string, dateDue: string): string {
  if (status === 'paid' || status === 'draft' || status === 'archived' || status === 'refunded') return status
  if (dateDue && daysUntilDue(dateDue) < 0) return 'overdue'
  return status
}

function statusBorder(status: string) {
  if (status === 'viewed' || status === 'sent') return '3px solid #F5B844'
  if (status === 'overdue') return '3px solid #C93E57'
  if (status === 'paid') return '3px solid #2FA84F'
  if (status === 'draft') return '3px solid #B0BAC6'
  if (status === 'refunded') return '3px solid #9333EA'
  return undefined
}

// Bright-green right edge: invoice accepts online payments and can still be paid
function showsOnlinePayEdge(inv: InvoiceRow): boolean {
  return !!inv.onlinePaymentsEnabled && !['paid', 'refunded'].includes(inv.status)
}

function relativeDue(dateDue: string, status: string, paidDate?: string | null): string {
  if (status === 'paid') {
    return paidDate ? `Paid ${formatDateLong(paidDate)}` : '\u2014'
  }
  if (status === 'refunded' || status === 'archived') return '\u2014'
  const diffDays = daysUntilDue(dateDue)
  if (diffDays < 0) {
    const a = Math.abs(diffDays)
    if (a >= 60) return `Overdue by ${Math.floor(a / 30)} months`
    return `Overdue by ${a} day${a === 1 ? '' : 's'}`
  }
  if (diffDays === 0) return 'Due today'
  if (diffDays === 1) return 'Due tomorrow'
  if (diffDays >= 60) return `Due in ${Math.floor(diffDays / 30)} months`
  return `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`
}

function relativeDueColor(dateDue: string, status: string): string {
  if (status === 'paid' || status === 'refunded' || status === 'archived')
    return 'text-[#8C9BAB]'
  if (daysUntilDue(dateDue) < 0) return 'text-[#BF2600]'
  return 'text-[#576981]'
}

function clientDisplayName(c: InvoiceRow['client']) {
  if (c.organization) return c.organization
  return `${c.firstName} ${c.lastName}`.trim() || 'No Client'
}

export default function InvoicesListSection({
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

  const refetch = useCallback(() => {
    const params = stateToParams(state)
    startTransition(async () => {
      const res = await fetch(`/api/invoices/table?${params.toString()}`, {
        cache: 'no-store',
      })
      if (res.ok) setData((await res.json()) as ListPayload)
    })
  }, [state])

  // Remove a single row in place after a successful delete — no page refresh.
  const removeRow = useCallback((id: string) => {
    setData((d) => ({
      ...d,
      rows: d.rows.filter((r) => r.id !== id),
      totalCount: Math.max(0, d.totalCount - 1),
    }))
    setSelected((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [])

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const params = stateToParams(state)
    window.history.replaceState(
      {},
      '',
      `/invoices${params.toString() ? `?${params}` : ''}`
    )
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await fetch(`/api/invoices/table?${params.toString()}`, {
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

  function setSort(field: QueryState['sortBy']) {
    setState((s) =>
      s.sortBy === field
        ? { ...s, sortDir: s.sortDir === 'asc' ? 'desc' : 'asc', page: 1 }
        : { ...s, sortBy: field, sortDir: 'desc', page: 1 }
    )
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
        <h2 className="text-base font-semibold text-[#001B40]">
          All Invoices{' '}
          <span className="font-normal text-[#576981]">({data.totalCount})</span>
        </h2>
        <div className="flex items-center gap-3 flex-wrap" data-print="hide">
          {selected.size > 0 && (
            <a
              href={`/api/invoices/pdf/bulk?ids=${Array.from(selected).join(',')}`}
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
          <AdvancedInvoiceSearchPanel
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
            <li className="px-4 py-12 text-center text-sm text-[#576981]">No invoices found.</li>
          ) : (
            data.rows.map((inv) => {
              const desc = inv.description || ''
              const href = `/invoices/${inv.id}`
              return (
                <li
                  key={inv.id}
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
                  className="relative px-4 py-1 cursor-pointer hover:bg-[#F5F7FA] flex items-start gap-3"
                  style={
                    statusBorder(effectiveStatus(inv.status, inv.dateDue))
                      ? { borderLeft: statusBorder(effectiveStatus(inv.status, inv.dateDue)) }
                      : undefined
                  }
                >
                  {showsOnlinePayEdge(inv) && (
                    <span
                      className="absolute right-0 top-0 bottom-0 w-[3px] bg-[#22C55E]"
                      title="Online Payments Enabled"
                    />
                  )}
                  <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      style={{ width: 22, height: 22 }}
                      checked={selected.has(inv.id)}
                      onChange={() => toggleOne(inv.id)}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-medium text-[#001B40] truncate">
                          {clientDisplayName(inv.client)}
                        </div>
                        <div className="text-[13px] text-[#576981] mt-0.5">
                          {formatInvoiceNumber(Number(inv.invoiceNumber))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[15px] font-medium text-[#001B40] whitespace-nowrap">
                          {formatCurrency(inv.total, inv.currency, { includeCode: false })}{' '}
                          <span className="text-[11px] text-[#576981]">{inv.currency}</span>
                        </div>
                        <div className="mt-1 flex justify-end">
                          <StatusBadge status={effectiveStatus(inv.status, inv.dateDue)} />
                        </div>
                      </div>
                    </div>
                    {desc && (
                      <div className="text-[13px] text-[#576981] truncate mt-1">{desc}</div>
                    )}
                    <div className="mt-2 flex items-center justify-between text-[12px] text-[#576981]">
                      <span>Due {formatDate(inv.dateDue)}</span>
                      <span className={relativeDueColor(inv.dateDue, inv.status)}>
                        {relativeDue(inv.dateDue, inv.status, inv.paidDate)}
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
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981] w-[220px]">
                <SortBtn
                  active={state.sortBy === 'invoiceNumber'}
                  dir={state.sortDir}
                  onClick={() => setSort('invoiceNumber')}
                  label="Client / Invoice Number"
                />
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                Description
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                <SortBtn
                  active={state.sortBy === 'dateIssued'}
                  dir={state.sortDir}
                  onClick={() => setSort('dateIssued')}
                  label="Issued Date"
                />
              </th>
              <th className="px-4 py-1 text-left text-xs font-normal text-[#576981]">
                <SortBtn
                  active={state.sortBy === 'dateDue'}
                  dir={state.sortDir}
                  onClick={() => setSort('dateDue')}
                  label="Due Date"
                />
              </th>
              <th className="px-4 py-1 text-right text-xs font-normal text-[#576981]">
                <SortBtn
                  active={state.sortBy === 'total'}
                  dir={state.sortDir}
                  onClick={() => setSort('total')}
                  label="Amount / Status"
                  align="right"
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E1E6EB]">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-[#576981]">
                  No invoices found.
                </td>
              </tr>
            ) : (
              data.rows.map((inv) => {
                const desc = inv.description || ''
                const href = `/invoices/${inv.id}`
                return (
                  <tr
                    key={inv.id}
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
                    className="table-row-hover cursor-pointer group relative"
                    style={
                      statusBorder(effectiveStatus(inv.status, inv.dateDue))
                        ? { borderLeft: statusBorder(effectiveStatus(inv.status, inv.dateDue)) }
                        : undefined
                    }
                  >
                    <td className="pl-4 pr-2 py-1" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        style={{ width: 25, height: 25 }}
                        checked={selected.has(inv.id)}
                        onChange={() => toggleOne(inv.id)}
                      />
                    </td>
                    <td className="px-4 py-1 w-[220px]">
                      <div className="text-[16px] font-medium text-[#001B40] leading-tight truncate">
                        {clientDisplayName(inv.client)}
                      </div>
                      <div className="text-[14px] text-[#576981] mt-0.5">
                        {formatInvoiceNumber(Number(inv.invoiceNumber))}
                      </div>
                    </td>
                    <td className="px-4 py-1 text-[14px] text-[#001B40] truncate max-w-[320px]">
                      {desc}
                    </td>
                    <td className="px-4 py-1">
                      <div className="text-[16px] font-medium text-[#001B40] leading-tight">
                        {formatDate(inv.dateIssued)}
                      </div>
                    </td>
                    <td className="px-4 py-1">
                      <div className="text-[16px] font-medium text-[#001B40] leading-tight">
                        {formatDate(inv.dateDue)}
                      </div>
                      <div className={`text-[14px] mt-0.5 ${relativeDueColor(inv.dateDue, inv.status)}`}>
                        {relativeDue(inv.dateDue, inv.status, inv.paidDate)}
                      </div>
                    </td>
                    <td className="px-4 py-1 text-right relative">
                      <div className="text-[16px] font-medium text-[#001B40]">
                        {formatCurrency(inv.total, inv.currency, {
                          includeCode: false,
                        })}{' '}
                        <span className="text-[12px] font-normal text-[#576981]">
                          {inv.currency}
                        </span>
                      </div>
                      <div className="mt-1 flex justify-end">
                        <StatusBadge status={effectiveStatus(inv.status, inv.dateDue)} />
                      </div>
                      <InvoiceRowActions
                        invoiceId={inv.id}
                        invoiceNumber={inv.invoiceNumber}
                        currency={inv.currency}
                        amountDue={inv.amountDue}
                        onChanged={refetch}
                        onDeleted={removeRow}
                      />
                      {showsOnlinePayEdge(inv) && (
                        <span
                          className="absolute right-0 top-0 bottom-0 w-[3px] bg-[#22C55E]"
                          title="Online Payments Enabled"
                        />
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        </div>

        {data.totals && data.totals.length > 0 && (
          <div className="mt-4 bg-[#F5F7FA] border border-[#E1E6EB] rounded px-6 py-4 flex justify-end">
            <div className="text-right">
              {data.totals.map(([c, amt], i) => (
                <div key={c} className="text-[15px] text-[#001B40]">
                  {i === 0 && (
                    <span className="text-[#576981] mr-2">Grand Total:</span>
                  )}
                  <span className="font-medium">
                    {formatCurrency(amt, c, { includeCode: false })}
                  </span>{' '}
                  <span className="text-xs text-[#576981]">{c}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 px-4 py-3" data-print="hide">
          <span className="text-sm text-[#576981]">Show</span>
          <div className="flex gap-1">
            {[25, 50, 100].map((n) => (
              <button
                key={n}
                onClick={() => setState((s) => ({ ...s, perPage: n, page: 1 }))}
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
            {data.totalCount} {data.totalCount === 1 ? 'invoice' : 'invoices'} total
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
