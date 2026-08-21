'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  align?: 'left' | 'right'
  placeholder?: string
  className?: string
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function fromISO(s: string): Date | null {
  if (!s) return null
  const [y, m, d] = s.split('-').map((n) => parseInt(n, 10))
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function fmtShort(s: string): string {
  const d = fromISO(s)
  if (!d) return ''
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

interface Preset {
  label: string
  compute: (now: Date) => { from: string; to: string }
}

const PRESETS: Preset[] = [
  {
    label: 'Today',
    compute: (now) => {
      const t = toISO(now)
      return { from: t, to: t }
    },
  },
  {
    label: 'Yesterday',
    compute: (now) => {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      const s = toISO(y)
      return { from: s, to: s }
    },
  },
  {
    label: 'Last 7 Days',
    compute: (now) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)
      return { from: toISO(start), to: toISO(now) }
    },
  },
  {
    label: 'Last 30 Days',
    compute: (now) => {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)
      return { from: toISO(start), to: toISO(now) }
    },
  },
  {
    label: 'This Month',
    compute: (now) => {
      const s = new Date(now.getFullYear(), now.getMonth(), 1)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: toISO(s), to: toISO(e) }
    },
  },
  {
    label: 'Last Month',
    compute: (now) => {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toISO(s), to: toISO(e) }
    },
  },
  {
    label: 'This Quarter',
    compute: (now) => {
      const qs = Math.floor(now.getMonth() / 3) * 3
      const s = new Date(now.getFullYear(), qs, 1)
      const e = new Date(now.getFullYear(), qs + 3, 0)
      return { from: toISO(s), to: toISO(e) }
    },
  },
  {
    label: 'Last Quarter',
    compute: (now) => {
      const qs = Math.floor(now.getMonth() / 3) * 3 - 3
      const y = qs < 0 ? now.getFullYear() - 1 : now.getFullYear()
      const m = ((qs % 12) + 12) % 12
      const s = new Date(y, m, 1)
      const e = new Date(y, m + 3, 0)
      return { from: toISO(s), to: toISO(e) }
    },
  },
  {
    label: 'Last 12 Months',
    compute: (now) => {
      const s = new Date(now.getFullYear(), now.getMonth() - 11, 1)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: toISO(s), to: toISO(e) }
    },
  },
  {
    label: 'This Year',
    compute: (now) => {
      const s = new Date(now.getFullYear(), 0, 1)
      const e = new Date(now.getFullYear(), 11, 31)
      return { from: toISO(s), to: toISO(e) }
    },
  },
  {
    label: 'Last Year',
    compute: (now) => {
      const s = new Date(now.getFullYear() - 1, 0, 1)
      const e = new Date(now.getFullYear() - 1, 11, 31)
      return { from: toISO(s), to: toISO(e) }
    },
  },
]

export default function DateRangeField({
  from,
  to,
  onChange,
  align = 'left',
  placeholder = 'Select date range',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const [pendingFrom, setPendingFrom] = useState(from)
  const [pendingTo, setPendingTo] = useState(to)

  const [view, setView] = useState<Date>(() => {
    const d = fromISO(from || to) || new Date()
    return startOfMonth(d)
  })

  useEffect(() => {
    if (open) {
      setPendingFrom(from)
      setPendingTo(to)
      const d = fromISO(from || to) || new Date()
      setView(startOfMonth(d))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (pendingFrom !== from || pendingTo !== to) {
          onChange(pendingFrom, pendingTo)
        }
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingFrom, pendingTo, from, to])

  function selectDate(iso: string) {
    if (!pendingFrom || (pendingFrom && pendingTo)) {
      setPendingFrom(iso)
      setPendingTo('')
      return
    }
    if (iso < pendingFrom) {
      setPendingTo(pendingFrom)
      setPendingFrom(iso)
    } else {
      setPendingTo(iso)
    }
  }

  function applyPreset(p: Preset) {
    const r = p.compute(new Date())
    setPendingFrom(r.from)
    setPendingTo(r.to)
    onChange(r.from, r.to)
    setOpen(false)
  }

  function clearAll() {
    setPendingFrom('')
    setPendingTo('')
    onChange('', '')
    setOpen(false)
  }

  function done() {
    if (pendingFrom !== from || pendingTo !== to) {
      onChange(pendingFrom, pendingTo)
    }
    setOpen(false)
  }

  function gotoToday() {
    setView(startOfMonth(new Date()))
  }

  function renderMonth(monthDate: Date) {
    const y = monthDate.getFullYear()
    const m = monthDate.getMonth()
    const firstDow = new Date(y, m, 1).getDay()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const today = toISO(new Date())
    const cells: { iso: string; day: number; current: boolean }[] = []

    const prevMonthDays = new Date(y, m, 0).getDate()
    for (let i = firstDow - 1; i >= 0; i--) {
      const d = prevMonthDays - i
      cells.push({
        iso: toISO(new Date(y, m - 1, d)),
        day: d,
        current: false,
      })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ iso: toISO(new Date(y, m, d)), day: d, current: true })
    }
    let nextDay = 1
    while (cells.length < 42) {
      cells.push({
        iso: toISO(new Date(y, m + 1, nextDay)),
        day: nextDay,
        current: false,
      })
      nextDay++
    }

    return (
      <div>
        <div className="grid grid-cols-7 text-[11px] text-[#576981] mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
            <div key={i} className="text-center py-1">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const inRange =
              pendingFrom &&
              pendingTo &&
              c.iso >= pendingFrom &&
              c.iso <= pendingTo
            const isStart = c.iso === pendingFrom
            const isEnd = c.iso === pendingTo
            const isEndpoint = isStart || isEnd
            const isToday = c.iso === today
            return (
              <button
                key={i}
                type="button"
                onClick={() => selectDate(c.iso)}
                className={[
                  'h-8 text-xs flex items-center justify-center transition-colors rounded',
                  c.current ? 'text-[#001B40]' : 'text-[#B5C0CC]',
                  inRange && !isEndpoint ? 'bg-[#E6F1FB] rounded-none' : '',
                  isEndpoint
                    ? 'bg-[#0075DD] text-white font-semibold'
                    : 'hover:bg-[#F5F7FA]',
                  !isEndpoint && isToday
                    ? 'ring-1 ring-[#0075DD] ring-inset'
                    : '',
                ].join(' ')}
              >
                {c.day}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  const triggerLabel = (() => {
    if (!from && !to) return placeholder
    if (from && to && from === to) return fmtShort(from)
    if (from && to) return `${fmtShort(from)} – ${fmtShort(to)}`
    if (from) return `${fmtShort(from)} – …`
    return `… – ${fmtShort(to)}`
  })()

  const hasValue = !!(from || to)
  const alignCls = align === 'right' ? 'right-0' : 'left-0'

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`w-full h-9 px-3 inline-flex items-center justify-between gap-2 border border-[#E1E6EB] rounded text-sm bg-white hover:border-[#B5C0CC] focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD] ${
          hasValue ? 'text-[#001B40]' : 'text-[#8898AA]'
        }`}
      >
        <span className="truncate text-left">{triggerLabel}</span>
        <svg
          className="w-4 h-4 flex-shrink-0 text-[#576981]"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute z-40 ${alignCls} top-full mt-2 bg-white border border-[#E1E6EB] rounded-lg shadow-lg flex flex-col sm:flex-row`}
          style={{ width: 'min(560px, 95vw)' }}
        >
          <div className="border-b sm:border-b-0 sm:border-r border-[#E1E6EB] sm:w-[140px] flex-shrink-0">
            <div className="flex sm:flex-col overflow-x-auto sm:overflow-visible py-1 sm:py-2">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="text-left text-xs sm:text-sm text-[#001B40] px-3 py-1.5 hover:bg-[#F5F7FA] flex-shrink-0 sm:w-full whitespace-nowrap"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 p-3 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setView(addMonths(view, -1))}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F5F7FA] text-[#576981]"
                aria-label="Previous month"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div className="text-sm font-semibold text-[#001B40]">
                {view.toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}
              </div>
              <button
                type="button"
                onClick={() => setView(addMonths(view, 1))}
                className="w-7 h-7 flex items-center justify-center rounded hover:bg-[#F5F7FA] text-[#576981]"
                aria-label="Next month"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
            {renderMonth(view)}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#E1E6EB]">
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-[#0075DD] hover:underline"
              >
                Clear
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={gotoToday}
                  className="text-xs text-[#0075DD] hover:underline"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={done}
                  className="px-3 h-7 rounded bg-[#2FA84F] hover:bg-[#288F44] text-white text-xs font-medium"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
