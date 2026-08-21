'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import PaymentRow from './PaymentRow'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import AdvancedPaymentSearchPanel, {
  AdvancedPaymentFilters,
} from './AdvancedPaymentSearchPanel'

export interface PaymentRowData {
  id: string
  paymentDate: string
  paymentMethod: string | null
  amount: string
  currency: string
  notes: string | null
  status: string
  invoiceId: string | null
  client: {
    firstName: string
    lastName: string
    organization: string
  }
  invoice: { id: string; invoiceNumber: string } | null
}

export interface ListPayload {
  rows: PaymentRowData[]
  totalCount: number
  totalPages: number
  perPage: number
  page: number
  sortBy: string
  sortDir: 'asc' | 'desc'
}

interface QueryState {
  page: number
  perPage: number
  search: string
  sortBy: 'paymentDate' | 'amount'
  sortDir: 'asc' | 'desc'
  advanced: AdvancedPaymentFilters
}

function stateToParams(s: QueryState): URLSearchParams {
  const p = new URLSearchParams()
  if (s.page !== 1) p.set('page', String(s.page))
  if (s.perPage !== 40) p.set('perPage', String(s.perPage))
  if (s.search) p.set('search', s.search)
  if (s.sortBy !== 'paymentDate') p.set('sortBy', s.sortBy)
  if (s.sortDir !== 'desc') p.set('sort', s.sortDir)
  const a = s.advanced
  if (a.clientId) p.set('clientId', a.clientId)
  if (a.paymentMethod) p.set('paymentMethod', a.paymentMethod)
  if (a.source) p.set('source', a.source)
  if (a.dateFrom) p.set('dateFrom', a.dateFrom)
  if (a.dateTo) p.set('dateTo', a.dateTo)
  if (a.amountMin) p.set('amountMin', a.amountMin)
  if (a.amountMax) p.set('amountMax', a.amountMax)
  if (a.currency) p.set('currency', a.currency)
  if (a.keyword) p.set('keyword', a.keyword)
  return p
}

function advancedKey(a: AdvancedPaymentFilters): string {
  return [
    a.clientId,
    a.paymentMethod,
    a.source,
    a.dateFrom,
    a.dateTo,
    a.amountMin,
    a.amountMax,
    a.currency,
    a.keyword,
  ].join('|')
}

export default function PaymentsListSection({
  initial,
  initialState,
}: {
  initial: ListPayload
  initialState: QueryState
}) {
  const [state, setState] = useState<QueryState>(initialState)
  const [data, setData] = useState<ListPayload>(initial)
  const [loading, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstRun = useRef(true)
  const { confirm, dialog } = useConfirm()

  const allSelected =
    data.rows.length > 0 && data.rows.every((r) => selected.has(r.id))
  const someSelected =
    !allSelected && data.rows.some((r) => selected.has(r.id))

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

  function handleBulkDelete() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    confirm({
      title: 'Delete payments',
      message: `Delete ${ids.length} payment${ids.length === 1 ? '' : 's'}? This will update the associated invoice balances.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        setDeleting(true)
        try {
          const results = await Promise.allSettled(
            ids.map((id) =>
              fetch(`/api/payments/${id}`, { method: 'DELETE' })
            )
          )
          const failed = results.filter(
            (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
          ).length
          if (failed > 0) {
            toast.error(`${failed} of ${ids.length} deletions failed.`)
          }
          setSelected(new Set())
          const params = stateToParams(state)
          const res = await fetch(`/api/payments/table?${params.toString()}`, {
            cache: 'no-store',
          })
          if (res.ok) setData((await res.json()) as ListPayload)
        } finally {
          setDeleting(false)
        }
      },
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
      `/payments${params.toString() ? `?${params}` : ''}`
    )
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const res = await fetch(`/api/payments/table?${params.toString()}`, {
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
      {dialog}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-3">
        <h2 className="text-base font-semibold text-[#001B40]">
          All Invoice Payments
        </h2>
        <div className="flex items-center gap-3 flex-wrap" data-print="hide">
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 px-3 h-9 rounded-full bg-[#BF2600] text-white text-sm font-medium hover:bg-[#9a1f00] disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
              </svg>
              {deleting ? 'Deleting...' : `Delete (${selected.size})`}
            </button>
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
          <AdvancedPaymentSearchPanel
            filters={state.advanced}
            onApply={(advanced) =>
              setState((s) => ({ ...s, advanced, page: 1 }))
            }
          />
        </div>
      </div>

      <div className={loading ? 'opacity-60 transition-opacity' : ''}>
        <div className="-mx-4 sm:mx-0">
        {/* Table header */}
        <div className="hidden sm:grid grid-cols-[40px_1fr_140px_1fr_160px] gap-4 px-4 py-1 border-b border-[#E1E6EB] text-xs font-normal text-[#576981] items-center">
          <input
            type="checkbox"
            className="rounded border-gray-300"
            style={{ width: 20, height: 20 }}
            aria-label="Select all"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected }}
            onChange={toggleAll}
          />
          <div>Client / Invoice Number</div>
          <SortBtn
            active={state.sortBy === 'paymentDate'}
            dir={state.sortDir}
            onClick={() => setSort('paymentDate')}
            label="Payment Date"
          />
          <div>Payment Method / Internal Notes</div>
          <SortBtn
            active={state.sortBy === 'amount'}
            dir={state.sortDir}
            onClick={() => setSort('amount')}
            label="Amount / Status"
            align="right"
          />
        </div>

        {data.rows.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <p className="text-sm text-[#576981]">No payments found.</p>
          </div>
        ) : (
          data.rows.map((p) => (
            <PaymentRow
              key={p.id}
              payment={p}
              selected={selected.has(p.id)}
              onToggleSelected={() => toggleOne(p.id)}
            />
          ))
        )}
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
      } ${align === 'right' ? 'ml-auto justify-end' : ''}`}
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
