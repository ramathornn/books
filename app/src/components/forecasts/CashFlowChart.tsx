'use client'

// Day-by-day projected balance as a line, with a dot on every day something
// lands. Same events and anchor as the timeline below it.

import { useMemo } from 'react'
import { useForecast } from './ForecastProvider'
import { CHART_COLORS, EventLineChart, type EventPoint } from './charts'
import { balanceAt, buildEvents, computeBase, groupByDay, pickAnchor, withRunningBalance } from '@/lib/forecasts/dailyBalance'
import { daysInMonth, parseMonthLabel } from '@/lib/forecasts/months'
import { fmtMoney } from '@/lib/forecasts/computed'

const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const IN = '#2FA84F', OUT = '#DE350B', RECORDED = '#9065B0'
const MAX_ROWS = 6

export default function CashFlowChart() {
  const { data, computed, rates } = useForecast()
  const { from, to } = computed

  const events = useMemo(() => buildEvents(data, rates), [data, rates])
  const anchor = useMemo(() => pickAnchor(data), [data])
  const base = useMemo(() => computeBase(events, anchor), [events, anchor])
  const annotated = useMemo(() => withRunningBalance(events, base), [events, base])
  const now = useMemo(() => new Date().getTime(), [])

  const fromP = parseMonthLabel(data.months[from])
  const toP = parseMonthLabel(data.months[to])
  if (!fromP || !toP) return null
  const fromMs = new Date(fromP.year, fromP.month, 1).getTime()
  const toMs = new Date(toP.year, toP.month, daysInMonth(toP), 23, 59, 59).getTime()

  const dayLabel = (d: Date) => `${MO[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
  const points: EventPoint[] = groupByDay(annotated, fromMs, toMs).map((g) => {
    const net = g.events.reduce((s, e) => s + e.amount, 0)
    const rows = g.events.slice(0, MAX_ROWS).map((e) => ({ name: e.label, value: `${e.amount >= 0 ? '+' : '−'}${fmtMoney(Math.abs(e.amount))}`, color: e.section === 'income' ? IN : OUT }))
    if (g.events.length > MAX_ROWS) rows.push({ name: `+${g.events.length - MAX_ROWS} more`, value: '', color: '#C9D1DA' })
    rows.push({ name: 'Balance', value: fmtMoney(g.balance), color: CHART_COLORS[0] })
    return { t: g.date.getTime(), value: g.balance, label: dayLabel(g.date), color: net >= 0 ? IN : OUT, rows }
  })
  if (anchor && anchor.t >= fromMs && anchor.t <= toMs) {
    points.push({ t: anchor.t, value: anchor.amount, label: dayLabel(anchor.date), color: RECORDED, rows: [{ name: 'Recorded cash on hand', value: fmtMoney(anchor.amount), color: RECORDED }] })
    points.sort((a, b) => a.t - b.t)
  }

  const ticks = data.months.slice(from, to + 1).flatMap((label) => { const p = parseMonthLabel(label); return p ? [{ t: new Date(p.year, p.month, 1).getTime(), label }] : [] })
  const legend = [['Money in', IN], ['Money out', OUT], ['Recorded balance', RECORDED]]

  return (
    <div>
      <EventLineChart points={points} start={fromMs} end={toMs} startValue={balanceAt(base, events, fromMs - 1)} ticks={ticks} marker={{ t: now, label: 'Today' }} height={300} />
      <div className="mt-2 flex flex-wrap gap-4 text-[12px] text-gray-500">
        {legend.map(([name, color]) => <span key={name} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} />{name}</span>)}
      </div>
    </div>
  )
}
