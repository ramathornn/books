'use client'

// Day-by-day projected balance: every dated income/expense event in the
// visible range, with the recorded cash-on-hand anchor and "today" markers.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useForecast } from './ForecastProvider'
import { balanceAt, buildEvents, computeBase, groupByDay, pickAnchor, withRunningBalance } from '@/lib/forecasts/dailyBalance'
import { daysInMonth, parseMonthLabel } from '@/lib/forecasts/months'
import { fmtMoney } from '@/lib/forecasts/computed'

const MO = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const fromISO = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d) }
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export default function CashFlowTimeline() {
  const { data, computed, rates } = useForecast()
  const { from, to } = computed
  const today = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }, [])
  const [asOf, setAsOf] = useState(() => toISO(new Date()))

  const events = useMemo(() => buildEvents(data, rates), [data, rates])
  const anchor = useMemo(() => pickAnchor(data), [data])
  const base = useMemo(() => computeBase(events, anchor), [events, anchor])
  const annotated = useMemo(() => withRunningBalance(events, base), [events, base])

  const fromP = parseMonthLabel(data.months[from])
  const toP = parseMonthLabel(data.months[to])
  const fromMs = fromP ? new Date(fromP.year, fromP.month, 1).getTime() : -Infinity
  const toMs = toP ? new Date(toP.year, toP.month, daysInMonth(toP), 23, 59, 59).getTime() : Infinity
  const groups = useMemo(() => groupByDay(annotated, fromMs, toMs), [annotated, fromMs, toMs])

  const asOfDate = fromISO(asOf)
  const expected = balanceAt(base, events, new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate(), 23, 59, 59))
  const sinceAnchor = anchor ? expected - anchor.amount : null
  const todayInRange = today.getTime() >= fromMs && today.getTime() <= toMs
  const anchorInRange = !!anchor && anchor.t >= fromMs && anchor.t <= toMs

  let anchorStandalone = anchorInRange
  let todayStandalone = todayInRange
  groups.forEach((g) => {
    if (anchorInRange && anchor && sameDay(g.date, anchor.date)) { g.isAnchor = true; anchorStandalone = false }
    if (todayInRange && sameDay(g.date, today)) { g.isToday = true; todayStandalone = false }
  })

  type DayItem = { type: 'day'; t: number; date: Date; group: (typeof groups)[number] }
  type MarkItem = { type: 'anchor' | 'today'; t: number; date: Date; balance: number; alsoToday?: boolean }
  type Item = DayItem | MarkItem
  const items: Item[] = groups.map((g) => ({ type: 'day', t: g.date.getTime(), date: g.date, group: g }))
  // The anchor and today are usually the same day and the same number; showing
  // them as two rows reads like two events.
  const merged = anchorStandalone && todayStandalone && !!anchor && sameDay(anchor.date, today)
  if (anchorStandalone && anchor) items.push({ type: 'anchor', t: anchor.t, date: anchor.date, balance: anchor.amount, alsoToday: merged })
  if (todayStandalone && !merged) items.push({ type: 'today', t: today.getTime(), date: today, balance: balanceAt(base, events, new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)) })
  const order = { anchor: 0, today: 1, day: 2 }
  items.sort((a, b) => a.t - b.t || order[a.type] - order[b.type])

  const render: ({ type: 'month'; key: string; label: string } | Item)[] = []
  let curMonth: number | null = null
  for (const it of items) {
    const mk = it.date.getFullYear() * 12 + it.date.getMonth()
    if (mk !== curMonth) { curMonth = mk; render.push({ type: 'month', key: `m${mk}`, label: `${MO[it.date.getMonth()]} ${it.date.getFullYear()}` }) }
    render.push(it)
  }

  const todayRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Scroll the list (not the page) so "today" sits mid-viewport on load.
  useEffect(() => {
    const el = todayRef.current, list = listRef.current
    if (el && list) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2)
  }, [data.id])
  const low = groups.reduce((m, g) => Math.min(m, g.balance), Infinity)

  // Bars are scaled against the largest single movement on screen.
  const maxAbs = groups.reduce((m, g) => g.events.reduce((n, e) => Math.max(n, Math.abs(e.amount)), m), 0)
  const barWidth = (amount: number) => (maxAbs > 0 ? Math.max(2, Math.round((Math.abs(amount) / maxAbs) * 40)) : 0)
  const lowRef = useRef<HTMLDivElement>(null)
  let lowSeen = false

  const GRID = 'grid grid-cols-[58px_minmax(0,1fr)_120px_92px] items-center gap-2'
  const dayLabel = (d: Date) => `${MO[d.getMonth()].slice(0, 3)} ${d.getDate()}`

  const Amount = ({ amount }: { amount: number }) => (
    <span className="flex items-center justify-end gap-1.5">
      <span className="h-1.5 rounded-sm" style={{ width: barWidth(amount), background: amount >= 0 ? '#8FD3A4' : '#F5A79A' }} />
      <span className={`tabular-nums ${amount >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(amount))}</span>
    </span>
  )

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-wide text-gray-500">Expected balance</p>
          <h2 className={`text-2xl font-semibold tabular-nums ${expected < 0 ? 'text-[#BF2600]' : 'text-gray-900'}`}>{fmtMoney(expected)}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            as of <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="h-7 rounded border border-gray-300 px-2 text-[12px] text-gray-700" />
            {sinceAnchor !== null && <span className={sinceAnchor >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}>{sinceAnchor >= 0 ? '▲' : '▼'} {fmtMoney(sinceAnchor)} since recorded</span>}
          </p>
        </div>
        <button type="button" onClick={() => setAsOf(toISO(new Date()))} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">Jump to today</button>
      </div>

      {!anchor && <div className="mb-3 rounded bg-[#FFF4E0] px-3 py-2 text-[13px] text-[#8F5E00]">No recorded balance yet, so the projection starts from $0. Use <strong>Record Balance</strong> to anchor it.</div>}
      {anchor && Number.isFinite(low) && low < 0 && (
        <button
          type="button"
          onClick={() => { const el = lowRef.current, list = listRef.current; if (el && list) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 3) }}
          className="mb-3 flex w-full items-center justify-between rounded bg-[#FFEBE6] px-3 py-2 text-left text-[13px] text-[#BF2600] hover:bg-[#FFD5CC]"
        >
          <span>Projected balance dips to <strong>{fmtMoney(low)}</strong> in this range.</span>
          <span className="text-[12px] underline">Show me</span>
        </button>
      )}

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No dated income or expenses in this range. Add amounts on Income / Expenses, then right-click a cell to set the day it lands on.</p>
      ) : (
        <div ref={listRef} className="relative max-h-[560px] overflow-y-auto pr-1">
          <div className={`${GRID} sticky top-0 z-20 border-b border-gray-200 bg-white pb-1 text-[10px] font-medium uppercase tracking-wide text-gray-400`}>
            <span>Date</span><span />
            <span className="text-right">Change</span>
            <span className="text-right">Balance</span>
          </div>
          {render.map((r) => {
            if (r.type === 'month') {
              return <div key={r.key} className="sticky top-[21px] z-10 bg-white/95 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 backdrop-blur">{r.label}</div>
            }

            if (r.type === 'anchor' || r.type === 'today') {
              const isToday = r.type === 'today' || !!(r as MarkItem).alsoToday
              const label = r.type === 'anchor' ? ((r as MarkItem).alsoToday ? 'Cash on hand · today' : 'Recorded cash on hand') : 'Today'
              return (
                <div key={r.type} ref={isToday ? todayRef : undefined} className={`${GRID} border-b border-gray-50 py-1.5`}>
                  <span className="text-[12px] text-gray-500">{dayLabel(r.date)}</span>
                  <span className="flex items-center gap-2 truncate">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${isToday ? 'bg-[#0075DD]' : 'bg-[#2FA84F]'}`} />
                    <span className={`truncate text-[13px] font-medium ${isToday ? 'text-[#0747A6]' : 'text-[#006644]'}`}>{label}</span>
                  </span>
                  <span className="text-right text-[13px] text-gray-300">—</span>
                  <span className={`text-right text-[13px] font-semibold tabular-nums ${r.balance < 0 ? 'text-[#BF2600]' : 'text-gray-900'}`}>{fmtMoney(r.balance)}</span>
                </div>
              )
            }

            // One line per event; the date shows once per day.
            const g = (r as DayItem).group
            return (
              <div key={g.key}>
                {g.events.map((e, j) => {
                  const negative = e.balance < 0
                  const flagLow = negative && !lowSeen
                  if (flagLow) lowSeen = true
                  const marker = j === 0 && (g.isToday || g.isAnchor)
                  return (
                    <div
                      key={j}
                      ref={flagLow ? lowRef : g.isToday && j === 0 ? todayRef : undefined}
                      className={`${GRID} border-b border-gray-50 py-1.5 ${negative ? 'border-l-2 border-l-[#FFAB00] bg-[#FFFBF5] pl-1' : ''} ${g.isToday ? 'bg-[#F4F9FF]' : ''}`}
                    >
                      <span className="text-[12px] text-gray-500">{j === 0 ? dayLabel(g.date) : ''}</span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${e.section === 'income' ? 'bg-[#2FA84F]' : 'bg-[#DE350B]'}`} />
                        <span className="truncate text-[13px] text-gray-700" title={e.label}>{e.label}</span>
                        {marker && g.isToday && <span className="shrink-0 rounded bg-[#DEEBFF] px-1.5 py-0.5 text-[10px] font-medium text-[#0747A6]">Today</span>}
                        {marker && g.isAnchor && !g.isToday && <span className="shrink-0 rounded bg-[#E3FCEF] px-1.5 py-0.5 text-[10px] font-medium text-[#006644]">Recorded</span>}
                      </span>
                      <span className="text-right text-[13px]"><Amount amount={e.amount} /></span>
                      <span className={`text-right text-[13px] font-semibold tabular-nums ${negative ? 'text-[#BF2600]' : 'text-gray-900'}`}>{fmtMoney(e.balance)}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
