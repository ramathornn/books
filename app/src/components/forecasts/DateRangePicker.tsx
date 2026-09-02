'use client'

import { useEffect, useRef, useState } from 'react'
import { MONTH_NAMES, monthLabel, parseMonthLabel } from '@/lib/forecasts/months'

/** Month-range popover: click a start month, then an end month. */
export default function DateRangePicker({ months, viewFrom, viewTo, onChange }: {
  months: string[]
  viewFrom: number
  viewTo: number
  onChange: (from: number, to: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [selecting, setSelecting] = useState<'from' | 'to' | null>(null)
  const [tempFrom, setTempFrom] = useState(viewFrom)
  const [tempTo, setTempTo] = useState(viewTo)
  const ref = useRef<HTMLDivElement>(null)

  const first = parseMonthLabel(months[0])
  const last = parseMonthLabel(months[months.length - 1])
  const startYear = first?.year ?? new Date().getFullYear()
  const endYear = (last?.year ?? startYear) + 2
  const [viewYear, setViewYear] = useState(() => parseMonthLabel(months[viewFrom])?.year ?? startYear)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setSelecting(null) } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Months after the range end are selectable too: picking one extends the workbook.
  const indexOf = (year: number, month: number): number => {
    const idx = months.indexOf(monthLabel(year, month))
    if (idx >= 0) return idx
    if (!first) return -1
    const diff = (year - first.year) * 12 + (month - first.month)
    return diff < 0 ? -1 : diff
  }

  const click = (year: number, month: number) => {
    const idx = indexOf(year, month)
    if (idx < 0) return
    if (selecting === 'from' || !selecting) { setTempFrom(idx); setTempTo(idx); setSelecting('to') }
    else {
      const f = Math.min(tempFrom, idx), t = Math.max(tempFrom, idx)
      onChange(f, t); setSelecting(null); setOpen(false)
    }
  }
  const from = selecting === 'to' ? tempFrom : viewFrom
  const to = selecting === 'to' ? tempTo : viewTo

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => { setOpen(!open); setSelecting('from') }} className="flex h-8 items-center gap-2 rounded border border-gray-300 bg-white px-3 text-[13px] text-gray-700 hover:bg-gray-50">
        <svg className="h-3.5 w-3.5 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3m8-3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" /></svg>
        <span className="font-medium">{months[viewFrom] ?? ''}</span>
        <span className="text-gray-400">to</span>
        <span className="font-medium">{months[viewTo] ?? ''}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-md border border-gray-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="rounded px-2 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30" disabled={viewYear <= startYear} onClick={() => setViewYear((y) => y - 1)}>‹</button>
            <span className="text-sm font-medium text-gray-900">{viewYear}</span>
            <button type="button" className="rounded px-2 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30" disabled={viewYear >= endYear} onClick={() => setViewYear((y) => y + 1)}>›</button>
          </div>
          <p className="mb-2 text-[11px] text-gray-500">{selecting === 'to' ? 'Select end month' : 'Select start month'}</p>
          <div className="grid grid-cols-4 gap-1">
            {MONTH_NAMES.map((m, mi) => {
              const idx = indexOf(viewYear, mi)
              const avail = idx >= 0
              const inRange = avail && idx >= from && idx <= to
              const edge = avail && (idx === from || idx === to)
              return (
                <button
                  key={m}
                  type="button"
                  disabled={!avail}
                  onClick={() => click(viewYear, mi)}
                  onMouseEnter={() => { if (selecting === 'to' && avail) setTempTo(idx) }}
                  className={`rounded px-1 py-1.5 text-[12px] ${!avail ? 'text-gray-300' : edge ? 'bg-[#0075DD] text-white' : inRange ? 'bg-[#DEEBFF] text-[#0747A6]' : 'text-gray-700 hover:bg-gray-100'}`}
                >
                  {m}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
