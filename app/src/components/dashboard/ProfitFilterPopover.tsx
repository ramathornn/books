'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

interface Props {
  triggerLabel: string
  start: string
  end: string
  groupBy: 'month' | 'quarter'
  currency: string
  currencies?: string[]
  hideCurrency?: boolean
}

export default function ProfitFilterPopover({
  triggerLabel,
  start,
  end,
  groupBy,
  currency,
  currencies = ['CAD', 'USD', 'EUR'],
  hideCurrency = false,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [localStart, setLocalStart] = useState(start)
  const [localEnd, setLocalEnd] = useState(end)
  const [localGroupBy, setLocalGroupBy] = useState(groupBy)
  const [localCurrency, setLocalCurrency] = useState(currency)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    setLocalStart(start)
    setLocalEnd(end)
    setLocalGroupBy(groupBy)
    setLocalCurrency(currency)
  }, [start, end, groupBy, currency])

  function push(next: {
    profitStart?: string
    profitEnd?: string
    profitGroupBy?: 'month' | 'quarter'
    currency?: string
  }) {
    const params = new URLSearchParams(searchParams.toString())
    const finalStart = next.profitStart ?? localStart
    const finalEnd = next.profitEnd ?? localEnd
    const finalGroupBy = next.profitGroupBy ?? localGroupBy
    const finalCurrency = next.currency ?? localCurrency

    params.set('profitStart', finalStart)
    params.set('profitEnd', finalEnd)
    params.delete('profitRange')

    if (finalGroupBy === 'quarter') params.set('profitGroupBy', 'quarter')
    else params.delete('profitGroupBy')

    params.set('currency', finalCurrency)

    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm text-[#576981] hover:text-[#001B40] transition-colors"
      >
        {triggerLabel}
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 mt-2 w-[280px] bg-white rounded-md shadow-lg border border-[#E1E6EB] p-4 z-50">
          <div className="text-sm font-semibold text-[#001B40] mb-3">Filters</div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs text-[#576981] mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={localStart}
                onChange={(e) => {
                  setLocalStart(e.target.value)
                  push({ profitStart: e.target.value })
                }}
                className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded-md focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#576981] mb-1">
                End Date
              </label>
              <input
                type="date"
                value={localEnd}
                onChange={(e) => {
                  setLocalEnd(e.target.value)
                  push({ profitEnd: e.target.value })
                }}
                className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded-md focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
              />
            </div>
          </div>

          <div className="mb-3">
            <div className="block text-xs text-[#576981] mb-1">Group By</div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-sm text-[#001B40] cursor-pointer">
                <input
                  type="radio"
                  name="profit-groupby"
                  checked={localGroupBy === 'month'}
                  onChange={() => {
                    setLocalGroupBy('month')
                    push({ profitGroupBy: 'month' })
                  }}
                  className="accent-[#0075DD]"
                />
                Month
              </label>
              <label className="flex items-center gap-1.5 text-sm text-[#001B40] cursor-pointer">
                <input
                  type="radio"
                  name="profit-groupby"
                  checked={localGroupBy === 'quarter'}
                  onChange={() => {
                    setLocalGroupBy('quarter')
                    push({ profitGroupBy: 'quarter' })
                  }}
                  className="accent-[#0075DD]"
                />
                Quarter
              </label>
            </div>
          </div>

          {!hideCurrency && (
            <div className="mb-2">
              <label className="block text-xs text-[#576981] mb-1">Currency</label>
              <select
                value={localCurrency}
                onChange={(e) => {
                  setLocalCurrency(e.target.value)
                  push({ currency: e.target.value })
                }}
                className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded-md focus:outline-none focus:ring-1 focus:ring-[#0075DD] bg-white"
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="text-[11px] text-[#576981] mt-2 leading-snug">
            <span className="inline-block w-3 h-3 rounded-full border border-[#576981] text-[#576981] text-center leading-[12px] mr-1">i</span>
            This graph represents the Collected (Cash-Based) Profit and Loss report
          </p>
        </div>
      )}
    </div>
  )
}
