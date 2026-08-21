'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  dateIssued: string
  value: string
  onChange: (value: string) => void
}

type Mode = 'onIssue' | 'days' | 'specific'

function formatDisplay(iso: string) {
  if (!iso) return 'Select date'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${m}/${d}/${y}`
}

function addDaysISO(iso: string, days: number) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10))
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().split('T')[0]
}

function diffDays(fromISO: string, toISO: string) {
  if (!fromISO || !toISO) return 0
  const [y1, m1, d1] = fromISO.split('-').map((n) => parseInt(n, 10))
  const [y2, m2, d2] = toISO.split('-').map((n) => parseInt(n, 10))
  const a = Date.UTC(y1, (m1 || 1) - 1, d1 || 1)
  const b = Date.UTC(y2, (m2 || 1) - 1, d2 || 1)
  return Math.round((b - a) / (1000 * 60 * 60 * 24))
}

export default function DueDatePicker({ dateIssued, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const specificRef = useRef<HTMLInputElement>(null)

  const initialDiff = diffDays(dateIssued, value)
  const [mode, setMode] = useState<Mode>(() => {
    if (!value || !dateIssued) return 'days'
    if (initialDiff === 0) return 'onIssue'
    return 'days'
  })
  const [days, setDays] = useState<number>(() => (initialDiff > 0 ? initialDiff : 30))

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Recompute due date when issue date changes for onIssue / days modes
  useEffect(() => {
    if (!dateIssued) return
    if (mode === 'onIssue' && value !== dateIssued) {
      onChange(dateIssued)
    } else if (mode === 'days') {
      const next = addDaysISO(dateIssued, days)
      if (next && next !== value) onChange(next)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIssued])

  function selectMode(next: Mode) {
    setMode(next)
    if (next === 'onIssue') {
      onChange(dateIssued)
    } else if (next === 'days') {
      onChange(addDaysISO(dateIssued, days))
    } else {
      // specific: keep current value, let user adjust
      setTimeout(() => specificRef.current?.showPicker?.(), 0)
    }
  }

  function updateDays(n: number) {
    const clamped = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
    setDays(clamped)
    if (mode === 'days') onChange(addDaysISO(dateIssued, clamped))
  }

  function openSpecificPicker() {
    const el = specificRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  }

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-2 py-1 text-sm text-[#001B40] rounded border border-transparent hover:border-[#E1E6EB] hover:bg-white focus:outline-none focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F]"
      >
        <span>{formatDisplay(value)}</span>
        <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-30 left-0 top-full mt-2 w-[340px] bg-white border border-[#E1E6EB] rounded-md shadow-lg p-4 text-left">
          <div className="text-sm font-semibold text-[#001B40] mb-3">Invoice Due Date</div>

          <label className="flex items-center gap-2 cursor-pointer py-1.5">
            <input
              type="radio"
              name="due-mode"
              checked={mode === 'onIssue'}
              onChange={() => selectMode('onIssue')}
              className="h-4 w-4 text-[#0075DD] focus:ring-[#0075DD]"
            />
            <span className="text-sm text-[#001B40]">On Date of Issue</span>
          </label>

          <div className="flex items-start gap-2 py-1.5">
            <input
              type="radio"
              name="due-mode"
              checked={mode === 'days'}
              onChange={() => selectMode('days')}
              className="h-4 w-4 mt-1 text-[#0075DD] focus:ring-[#0075DD]"
              id="due-mode-days"
            />
            <div className="flex-1 border-l border-[#E1E6EB] pl-3 -ml-1">
              <label htmlFor="due-mode-days" className="text-sm text-[#001B40] cursor-pointer">After a number of days</label>
              {mode === 'days' && (
                <div className="mt-2">
                  <div className="text-xs text-[#576981] mb-1">Days Until Due</div>
                  <input
                    type="number"
                    min={0}
                    value={days}
                    onChange={(e) => updateDays(parseInt(e.target.value, 10))}
                    className="w-20 px-2 py-1 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:border-[#0075DD]"
                  />
                </div>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer py-1.5">
            <input
              type="radio"
              name="due-mode"
              checked={mode === 'specific'}
              onChange={() => selectMode('specific')}
              className="h-4 w-4 text-[#0075DD] focus:ring-[#0075DD]"
            />
            <span className="text-sm text-[#001B40]">On a specific date</span>
          </label>

          {mode === 'specific' && (
            <div className="mt-2 pl-6">
              <button
                type="button"
                onClick={openSpecificPicker}
                className="inline-flex items-center gap-2 px-2 py-1 text-sm text-[#001B40] rounded border border-[#E1E6EB] hover:border-[#0075DD]"
              >
                <span>{formatDisplay(value)}</span>
                <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>
              <input
                ref={specificRef}
                type="date"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="sr-only"
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
