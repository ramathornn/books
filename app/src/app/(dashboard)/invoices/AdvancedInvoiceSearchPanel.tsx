'use client'

import { useEffect, useRef, useState } from 'react'
import DateRangeField from '@/components/ui/DateRangeField'

export interface AdvancedInvoiceFilters {
  status: string
  clientId: string
  dateIssuedFrom: string
  dateIssuedTo: string
  dateDueFrom: string
  dateDueTo: string
  amountMin: string
  amountMax: string
  currency: string
  keyword: string
}

export const emptyAdvancedInvoiceFilters: AdvancedInvoiceFilters = {
  status: '',
  clientId: '',
  dateIssuedFrom: '',
  dateIssuedTo: '',
  dateDueFrom: '',
  dateDueTo: '',
  amountMin: '',
  amountMax: '',
  currency: '',
  keyword: '',
}

export function countActiveAdvancedInvoiceFilters(
  f: AdvancedInvoiceFilters
): number {
  return (Object.keys(f) as (keyof AdvancedInvoiceFilters)[]).reduce(
    (acc, k) => (f[k] ? acc + 1 : acc),
    0
  )
}

interface ClientOption {
  id: string
  firstName: string
  lastName: string
  organization: string
}

interface Props {
  filters: AdvancedInvoiceFilters
  onApply: (f: AdvancedInvoiceFilters) => void
}

const STATUS_CHIPS = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
  { value: 'viewed', label: 'Viewed' },
  { value: 'partial', label: 'Partial' },
  { value: 'refunded', label: 'Refunded' },
]

const CURRENCY_OPTIONS = [
  { value: '', label: 'All currencies' },
  { value: 'CAD', label: 'CAD' },
  { value: 'USD', label: 'USD' },
  { value: 'EUR', label: 'EUR' },
  { value: 'GBP', label: 'GBP' },
  { value: 'AUD', label: 'AUD' },
  { value: 'JPY', label: 'JPY' },
]

export default function AdvancedInvoiceSearchPanel({
  filters,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Non-text fields apply immediately via patch(); text fields are held locally
  // and debounced so typing doesn't refetch on every keystroke.
  const [amountMin, setAmountMin] = useState(filters.amountMin)
  const [amountMax, setAmountMax] = useState(filters.amountMax)
  const [keyword, setKeyword] = useState(filters.keyword)
  const [clients, setClients] = useState<ClientOption[]>([])

  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply

  const activeCount = countActiveAdvancedInvoiceFilters(filters)

  function patch(p: Partial<AdvancedInvoiceFilters>) {
    onApplyRef.current({ ...filtersRef.current, ...p })
  }

  // Sync local text state when filters change externally (e.g. clear)
  useEffect(() => {
    setAmountMin(filters.amountMin)
    setAmountMax(filters.amountMax)
    setKeyword(filters.keyword)
  }, [filters.amountMin, filters.amountMax, filters.keyword])

  // Debounced apply for text fields
  useEffect(() => {
    const f = filtersRef.current
    if (
      amountMin === f.amountMin &&
      amountMax === f.amountMax &&
      keyword === f.keyword
    )
      return
    const t = setTimeout(() => patch({ amountMin, amountMax, keyword }), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountMin, amountMax, keyword])

  useEffect(() => {
    let cancelled = false
    fetch('/api/clients?limit=500')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const list: ClientOption[] = (data.data || []).map((c: ClientOption) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          organization: c.organization,
        }))
        list.sort((a, b) => {
          const aLabel = a.organization || `${a.firstName} ${a.lastName}`.trim()
          const bLabel = b.organization || `${b.firstName} ${b.lastName}`.trim()
          return aLabel.localeCompare(bLabel)
        })
        setClients(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // Desktop: close on outside click. Mobile sheet uses its own backdrop.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // Lock body scroll while the mobile sheet is open
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(max-width: 767px)')
    if (!mq.matches) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const status = filters.status
  const selectedStatuses = status ? status.split(',').filter(Boolean) : []
  function toggleStatus(value: string) {
    const set = new Set(selectedStatuses)
    if (set.has(value)) set.delete(value)
    else set.add(value)
    patch({ status: Array.from(set).join(',') })
  }

  function clearAll() {
    setAmountMin('')
    setAmountMax('')
    setKeyword('')
    onApplyRef.current({ ...emptyAdvancedInvoiceFilters })
  }

  return (
    <div ref={wrapperRef} className="relative" data-print="hide">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 h-9 rounded-full border border-[#E1E6EB] bg-white text-sm text-[#001B40] hover:border-[#B5C0CC]"
      >
        <svg
          className="w-4 h-4 text-[#576981]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        Advanced Search
        {activeCount > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#0075DD] text-white text-[11px] font-semibold">
            {activeCount}
          </span>
        )}
        <svg
          className={`w-3 h-3 text-[#576981] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <>
          {/* Mobile backdrop */}
          <div
            className="md:hidden fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-white border-t border-[#E1E6EB] shadow-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-2 md:w-[820px] md:max-h-none md:overflow-visible md:rounded-lg md:border md:shadow-lg md:z-30">
          <div className="md:hidden flex items-center justify-between mb-4">
            <span className="text-base font-semibold text-[#001B40]">
              Advanced Search
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="w-8 h-8 inline-flex items-center justify-center rounded-full text-[#576981] hover:bg-[#F2F5F8]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </button>
          </div>
          <Field label="Status">
            <div className="flex flex-wrap gap-2">
              <StatusChip
                active={selectedStatuses.length === 0}
                onClick={() => patch({ status: '' })}
              >
                All
              </StatusChip>
              {STATUS_CHIPS.map((o) => (
                <StatusChip
                  key={o.value}
                  active={selectedStatuses.includes(o.value)}
                  onClick={() => toggleStatus(o.value)}
                >
                  {o.label}
                </StatusChip>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="Client">
              <select
                value={filters.clientId}
                onChange={(e) => patch({ clientId: e.target.value })}
                className={inputCls + ' bg-white'}
              >
                <option value="">All clients</option>
                {clients.map((c) => {
                  const label =
                    c.organization ||
                    `${c.firstName} ${c.lastName}`.trim() ||
                    'Unnamed'
                  return (
                    <option key={c.id} value={c.id}>
                      {label}
                    </option>
                  )
                })}
              </select>
            </Field>
            <Field label="Currency">
              <select
                value={filters.currency}
                onChange={(e) => patch({ currency: e.target.value })}
                className={inputCls + ' bg-white'}
              >
                {CURRENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Field label="Date Issued">
              <DateRangeField
                from={filters.dateIssuedFrom}
                to={filters.dateIssuedTo}
                onChange={(f, t) => patch({ dateIssuedFrom: f, dateIssuedTo: t })}
              />
            </Field>
            <Field label="Date Due">
              <DateRangeField
                from={filters.dateDueFrom}
                to={filters.dateDueTo}
                align="right"
                onChange={(f, t) => patch({ dateDueFrom: f, dateDueTo: t })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
            <Field label="Amount min">
              <input
                type="number"
                step="0.01"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </Field>
            <Field label="Amount max">
              <input
                type="number"
                step="0.01"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </Field>
            <Field label="Keyword" className="col-span-2 md:col-span-1">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Number, description, notes, reference"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between mt-5">
            <span className="text-xs text-[#576981]">
              Filters apply as you change them
            </span>
            <button
              onClick={clearAll}
              disabled={activeCount === 0}
              className="px-4 h-9 rounded border border-[#E1E6EB] text-sm text-[#001B40] hover:border-[#B5C0CC] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Clear filters
            </button>
          </div>
          </div>
        </>
      )}
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function StatusChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 h-8 rounded-full border text-sm transition-colors ${
        active
          ? 'border-[#0075DD] bg-[#0075DD] text-white'
          : 'border-[#E1E6EB] bg-white text-[#001B40] hover:border-[#B5C0CC]'
      }`}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs text-[#576981] mb-1">{label}</span>
      {children}
    </label>
  )
}
