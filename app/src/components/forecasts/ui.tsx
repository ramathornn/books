'use client'

// Small presentational pieces shared by the Forecasts pages, styled to match
// the Books dashboard (white cards, gray-200 borders, #001B40 headings).

import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtMoney } from '@/lib/forecasts/computed'
import { parseMonthLabel } from '@/lib/forecasts/months'
import { useForecast } from './ForecastProvider'

export function Hero({ label, value, negative, badge, badgeTone = 'muted', sub, asOf = true }: {
  label: string
  value: string
  negative?: boolean
  badge?: React.ReactNode
  badgeTone?: 'green' | 'red' | 'muted'
  sub?: React.ReactNode
  /** Show the "as of" month picker that drives this figure. */
  asOf?: boolean
}) {
  const tone = badgeTone === 'green' ? 'bg-[#E3FCEF] text-[#006644]' : badgeTone === 'red' ? 'bg-[#FFEBE6] text-[#BF2600]' : 'bg-gray-100 text-gray-600'
  return (
    <div className="mb-6">
      <p className="text-[12px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <h1 className={`text-3xl font-semibold tabular-nums ${negative ? 'text-[#BF2600]' : 'text-gray-900'}`}>{value}</h1>
        {badge && <span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${tone}`}>{badge}</span>}
        {asOf && <AsOfSelect />}
      </div>
      {sub && <p className="mt-1 text-sm text-gray-500">{sub}</p>}
    </div>
  )
}

/** Month picker driving the headline figure. Defaults to the end of the view range. */
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function AsOfSelect() {
  const { data, computed, asOfIndex, setAsOfIndex } = useForecast()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // label -> index, plus the {year, month} of every month in the workbook.
  const parsed = useMemo(
    () => data.months.map((m, i) => ({ i, label: m, ...(parseMonthLabel(m) ?? { year: 0, month: 0 }) })),
    [data.months]
  )
  const selected = parsed[asOfIndex]
  const years = useMemo(() => [...new Set(parsed.map((p) => p.year))].sort((a, b) => a - b), [parsed])
  // The grid opens on the selected month's year; no effect needed.
  const [year, setYear] = useState(selected?.year ?? years[0])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (data.months.length < 2 || !selected) return null
  const yearIdx = years.indexOf(year)
  const pick = (index: number) => { setAsOfIndex(index); setOpen(false) }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => { if (!open && selected) setYear(selected.year); setOpen((o) => !o) }}
        title="Report the figure above as of the end of this month"
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors ${open ? 'border-[#0075DD] bg-[#DEEBFF] text-[#0747A6]' : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'}`}
      >
        <span className="text-gray-400">As of</span>
        <span className="font-medium">{selected.label}</span>
        <svg className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-[248px] rounded-lg border border-gray-200 bg-white p-2 shadow-xl">
          <div className="mb-1.5 flex items-center justify-between">
            <button type="button" disabled={yearIdx <= 0} onClick={() => setYear(years[yearIdx - 1])}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span className="text-[13px] font-semibold text-gray-900">{year}</span>
            <button type="button" disabled={yearIdx >= years.length - 1} onClick={() => setYear(years[yearIdx + 1])}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-4 gap-1">
            {MONTH_ABBR.map((abbr, m) => {
              const cell = parsed.find((p) => p.year === year && p.month === m)
              const isSelected = !!cell && cell.i === asOfIndex
              const isToday = !!cell && cell.i === computed.todayIdx
              return (
                <button
                  key={abbr}
                  type="button"
                  disabled={!cell}
                  onClick={() => cell && pick(cell.i)}
                  title={cell ? undefined : 'Outside the workbook — extend it in Settings'}
                  className={`relative h-8 rounded-md text-[12px] font-medium transition-colors ${
                    isSelected ? 'bg-[#0075DD] text-white'
                      : !cell ? 'cursor-not-allowed text-gray-300'
                      : 'text-gray-700 hover:bg-[#DEEBFF] hover:text-[#0747A6]'
                  }`}
                >
                  {abbr}
                  {isToday && !isSelected && <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[#0075DD]" />}
                </button>
              )
            })}
          </div>

          <div className="mt-2 flex gap-1 border-t border-gray-100 pt-2">
            <button type="button" onClick={() => pick(computed.todayIdx)}
              className="flex-1 rounded px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100">Today</button>
            <button type="button" onClick={() => pick(data.viewTo)}
              className="flex-1 rounded px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100">End of range</button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Card({ children, className = '', title, action }: { children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }) {
  return (
    <div className={`rounded-lg border border-gray-200 bg-white p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-gray-900">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-gray-900">{children}</h3>
      {sub && <p className="mt-0.5 text-[12px] text-gray-500">{sub}</p>}
    </div>
  )
}

export function MetricGrid({ metrics }: { metrics: { label: string; value: string; sub?: string; neg?: boolean }[] }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {metrics.map((m) => (
        <div key={m.label} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{m.label}</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${m.neg ? 'text-[#BF2600]' : 'text-gray-900'}`}>{m.value}</p>
          {m.sub && <p className="text-[11px] text-gray-400">{m.sub}</p>}
        </div>
      ))}
    </div>
  )
}

export function CategoryBars({ items, colors }: { items: { name: string; total: number }[]; colors: string[] }) {
  const max = items.reduce((m, c) => Math.max(m, c.total), 1)
  if (!items.length) return <p className="text-sm text-gray-400">No expenses in this range.</p>
  return (
    <div className="space-y-2">
      {items.map((c, i) => (
        <div key={c.name} className="grid grid-cols-[120px_1fr] items-center gap-3 text-[13px]">
          <span className="truncate text-gray-600" title={c.name}>{c.name}</span>
          <div className="relative h-5 rounded bg-gray-100">
            <div className="h-full rounded transition-[width] duration-500" style={{ width: `${(c.total / max) * 100}%`, background: colors[i % colors.length] }} />
            <span className="absolute right-2 top-0 text-[12px] leading-5 tabular-nums text-gray-700">{fmtMoney(c.total)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Inline "add a row" input with optional extra control (e.g. currency select). */
export function InlineAdd({ placeholder, onSubmit, onCancel, extra, prefix }: {
  placeholder: string
  onSubmit: (name: string) => void | Promise<unknown>
  onCancel: () => void
  extra?: React.ReactNode
  prefix?: React.ReactNode
}) {
  const [name, setName] = useState('')
  const submit = () => { if (name.trim()) void onSubmit(name.trim()) }
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {prefix}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        placeholder={placeholder}
        className="h-9 min-w-[220px] rounded border border-gray-300 px-3 text-sm focus:border-[#0075DD] focus:outline-none"
      />
      {extra}
      <button type="button" onClick={submit} className="h-9 rounded bg-[#038A06] px-3 text-sm font-medium text-white hover:bg-[#026e05]">Add</button>
      <button type="button" onClick={onCancel} className="h-9 rounded border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
    </div>
  )
}

export function AddButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="shrink-0 whitespace-nowrap rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
      + {children}
    </button>
  )
}

export const iconBtn = 'rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700'
export const iconBtnDanger = 'rounded p-1 text-gray-400 hover:bg-[#FFEBE6] hover:text-[#BF2600]'

export function PencilIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M4 20h4l10.5-10.5a2.5 2.5 0 00-3.536-3.536L4 16v4z" /></svg>
}
export function TrashIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M9 7V4h6v3m-7 0l1 13h6l1-13" /></svg>
}
export function CheckIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
}
export function XIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" /></svg>
}
export function CalendarIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path strokeLinecap="round" d="M3 10h18M8 3v4M16 3v4" /></svg>
}
export function EyeIcon({ off }: { off?: boolean }) {
  return off
    ? <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0121 12a10.5 10.5 0 01-2.2 3.2M6.6 6.6A10.5 10.5 0 003 12a10 10 0 0013.4 4.4" /></svg>
    : <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" /></svg>
}

export function LinkIcon() {
  return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 13.5a4 4 0 005.7 0l2.8-2.8a4 4 0 00-5.7-5.7l-1.4 1.4M13.5 10.5a4 4 0 00-5.7 0l-2.8 2.8a4 4 0 005.7 5.7l1.4-1.4" /></svg>
}

/** Green chain shown on a row that is already linked to something elsewhere. */
export function LinkedBadge({ to }: { to: string }) {
  return (
    <span className="inline-flex items-center p-1 text-[#038A06]" title={`Linked to ${to}`} aria-label={`Linked to ${to}`}>
      <LinkIcon />
    </span>
  )
}

/** Rename-in-place row action: pencil → input with save/cancel. */
export function RenameControl({ value, onRename }: { value: string; onRename: (next: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(value)
  if (!editing) {
    return <button type="button" className={iconBtn} title="Rename" onClick={() => { setName(value); setEditing(true) }}><PencilIcon /></button>
  }
  const save = () => { const n = name.trim(); if (n && n !== value) onRename(n); setEditing(false) }
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }} className="h-7 w-36 rounded border border-gray-300 px-2 text-[12px] focus:border-[#0075DD] focus:outline-none" />
      <button type="button" className={iconBtn} onClick={save} title="Save"><CheckIcon /></button>
      <button type="button" className={iconBtn} onClick={() => setEditing(false)} title="Cancel"><XIcon /></button>
    </span>
  )
}
