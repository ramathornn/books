'use client'

// Day-by-day projected balance: every dated income/expense event in the
// visible range, with the recorded cash-on-hand anchor and "today" markers.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useForecast } from './ForecastProvider'
import { balanceAt, buildEvents, computeBase, groupByDay, pickAnchor, withRunningBalance } from '@/lib/forecasts/dailyBalance'
import { daysInMonth, parseMonthLabel } from '@/lib/forecasts/months'
import { fmtMoney } from '@/lib/forecasts/computed'

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
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
  type MarkItem = { type: 'anchor' | 'today'; t: number; date: Date; balance: number }
  type Item = DayItem | MarkItem
  const items: Item[] = groups.map((g) => ({ type: 'day', t: g.date.getTime(), date: g.date, group: g }))
  if (anchorStandalone && anchor) items.push({ type: 'anchor', t: anchor.t, date: anchor.date, balance: anchor.amount })
  if (todayStandalone) items.push({ type: 'today', t: today.getTime(), date: today, balance: balanceAt(base, events, new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59)) })
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

  const DateCell = ({ date }: { date: Date }) => (
    <div className="w-12 shrink-0 text-center"><div className="text-[10px] uppercase text-gray-400">{WD[date.getDay()]}</div><div className="text-[15px] font-semibold text-gray-900">{date.getDate()}</div></div>
  )
  const Row = ({ date, children, balance, tone, refEl }: { date: Date; children: React.ReactNode; balance: number; tone?: 'anchor' | 'today' | 'neg'; refEl?: React.Ref<HTMLDivElement> }) => (
    <div ref={refEl} className={`flex items-start gap-3 rounded-md px-2 py-2 ${tone === 'today' ? 'bg-[#DEEBFF]/60' : tone === 'anchor' ? 'bg-[#E3FCEF]/60' : tone === 'neg' ? 'bg-[#FFEBE6]/40' : ''}`}>
      <DateCell date={date} />
      <div className="mt-2 w-3 shrink-0"><span className={`block h-2.5 w-2.5 rounded-full ${tone === 'today' ? 'bg-[#0075DD]' : tone === 'anchor' ? 'bg-[#2FA84F]' : 'bg-gray-300'}`} /></div>
      <div className="min-w-0 flex-1">{children}</div>
      <div className={`shrink-0 text-right text-[13px] font-semibold tabular-nums ${balance < 0 ? 'text-[#BF2600]' : 'text-gray-900'}`}>{fmtMoney(balance)}</div>
    </div>
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
      {anchor && Number.isFinite(low) && low < 0 && <div className="mb-3 rounded bg-[#FFEBE6] px-3 py-2 text-[13px] text-[#BF2600]">Projected balance dips to <strong>{fmtMoney(low)}</strong> in this range.</div>}

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No dated income or expenses in this range. Add amounts on Income / Expenses, then right-click a cell to set the day it lands on.</p>
      ) : (
        <div ref={listRef} className="relative max-h-[560px] space-y-0.5 overflow-y-auto pr-1">
          {render.map((r) => {
            if (r.type === 'month') return <div key={r.key} className="sticky top-0 z-10 bg-white/95 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-500 backdrop-blur">{r.label}</div>
            if (r.type === 'anchor') return <Row key="anchor" date={r.date} balance={r.balance} tone="anchor"><span className="inline-block rounded bg-[#E3FCEF] px-2 py-0.5 text-[11px] font-medium text-[#006644]">Recorded cash on hand</span></Row>
            if (r.type === 'today') return <Row key="today" refEl={todayRef} date={r.date} balance={r.balance} tone="today"><span className="inline-block rounded bg-[#DEEBFF] px-2 py-0.5 text-[11px] font-medium text-[#0747A6]">Today</span></Row>
            const g = (r as DayItem).group
            return (
              <Row key={g.key} refEl={g.isToday ? todayRef : undefined} date={g.date} balance={g.balance} tone={g.isToday ? 'today' : g.isAnchor ? 'anchor' : g.balance < 0 ? 'neg' : undefined}>
                {g.isToday && <span className="mr-2 inline-block rounded bg-[#DEEBFF] px-2 py-0.5 text-[11px] font-medium text-[#0747A6]">Today</span>}
                {g.isAnchor && anchor && <span className="mr-2 inline-block rounded bg-[#E3FCEF] px-2 py-0.5 text-[11px] font-medium text-[#006644]">Recorded {fmtMoney(anchor.amount)}</span>}
                <ul className="mt-0.5 space-y-0.5">
                  {g.events.map((e, j) => (
                    <li key={j} className="flex items-center gap-2 text-[13px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${e.section === 'income' ? 'bg-[#2FA84F]' : 'bg-[#DE350B]'}`} />
                      <span className="truncate text-gray-700">{e.label}</span>
                      <span className={`ml-auto tabular-nums ${e.amount >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{e.amount >= 0 ? '+' : '−'}{fmtMoney(Math.abs(e.amount))}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )
          })}
        </div>
      )}
    </div>
  )
}
