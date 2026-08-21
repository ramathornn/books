'use client'

import { useEffect, useRef, useState } from 'react'
import DateRangeField from '@/components/ui/DateRangeField'

export interface AdvancedEstimateFilters {
  status: string
  clientId: string
  dateIssuedFrom: string
  dateIssuedTo: string
  amountMin: string
  amountMax: string
  currency: string
  keyword: string
}

export const emptyAdvancedEstimateFilters: AdvancedEstimateFilters = {
  status: '',
  clientId: '',
  dateIssuedFrom: '',
  dateIssuedTo: '',
  amountMin: '',
  amountMax: '',
  currency: '',
  keyword: '',
}

export function countActiveAdvancedEstimateFilters(
  f: AdvancedEstimateFilters
): number {
  return (Object.keys(f) as (keyof AdvancedEstimateFilters)[]).reduce(
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
  filters: AdvancedEstimateFilters
  onApply: (f: AdvancedEstimateFilters) => void
}

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'expired', label: 'Expired' },
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

export default function AdvancedEstimateSearchPanel({
  filters,
  onApply,
}: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [status, setStatus] = useState(filters.status)
  const [clientId, setClientId] = useState(filters.clientId)
  const [dateIssuedFrom, setDateIssuedFrom] = useState(filters.dateIssuedFrom)
  const [dateIssuedTo, setDateIssuedTo] = useState(filters.dateIssuedTo)
  const [amountMin, setAmountMin] = useState(filters.amountMin)
  const [amountMax, setAmountMax] = useState(filters.amountMax)
  const [currency, setCurrency] = useState(filters.currency)
  const [keyword, setKeyword] = useState(filters.keyword)
  const [clients, setClients] = useState<ClientOption[]>([])

  const activeCount = countActiveAdvancedEstimateFilters(filters)

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

  useEffect(() => {
    if (open) {
      setStatus(filters.status)
      setClientId(filters.clientId)
      setDateIssuedFrom(filters.dateIssuedFrom)
      setDateIssuedTo(filters.dateIssuedTo)
      setAmountMin(filters.amountMin)
      setAmountMax(filters.amountMax)
      setCurrency(filters.currency)
      setKeyword(filters.keyword)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

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

  function apply() {
    onApply({
      status,
      clientId,
      dateIssuedFrom,
      dateIssuedTo,
      amountMin,
      amountMax,
      currency,
      keyword,
    })
    setOpen(false)
  }

  function resetAll() {
    setStatus('')
    setClientId('')
    setDateIssuedFrom('')
    setDateIssuedTo('')
    setAmountMin('')
    setAmountMax('')
    setCurrency('')
    setKeyword('')
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
        <div className="absolute right-0 top-full mt-2 w-[820px] bg-white border border-[#E1E6EB] rounded-lg shadow-lg p-5 z-30">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={inputCls + ' bg-white'}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client">
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
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
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
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

          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label="Date Issued">
              <DateRangeField
                from={dateIssuedFrom}
                to={dateIssuedTo}
                onChange={(f, t) => {
                  setDateIssuedFrom(f)
                  setDateIssuedTo(t)
                }}
              />
            </Field>
            <Field label="Amount (min / max)">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                  placeholder="Min"
                  className={inputCls}
                />
                <input
                  type="number"
                  step="0.01"
                  value={amountMax}
                  onChange={(e) => setAmountMax(e.target.value)}
                  placeholder="Max"
                  className={inputCls}
                />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 mt-4">
            <Field label="Keyword">
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Number, description, notes"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="flex items-center justify-between mt-5">
            <button
              onClick={resetAll}
              className="text-sm text-[#0075DD] hover:underline"
            >
              Reset all
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOpen(false)}
                className="px-4 h-9 text-sm text-[#001B40] hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                className="px-4 h-9 rounded bg-[#2FA84F] hover:bg-[#288F44] text-white text-sm font-medium"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs text-[#576981] mb-1">{label}</span>
      {children}
    </label>
  )
}
