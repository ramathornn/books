// Daily cash-flow engine: turns monthly income/expense cells into dated +/-
// events (each month's amount lands on its effective day) and projects a
// running balance anchored to the most recent recorded "cash on hand".

import type { ForecastData, Rates, Section } from './types'
import { convertToCAD } from './currency'
import { resolveValue } from './formula'
import { parseMonthLabel, daysInMonth } from './months'
import { effectiveDay } from './flowDays'

export interface CashEvent {
  date: Date
  t: number
  amount: number
  label: string
  section: Section
  monthIdx: number
  day: number
}

export interface Anchor { amount: number; date: Date; t: number; monthIdx: number; day: number }

export function buildEvents(data: ForecastData, rates: Rates): CashEvent[] {
  const { months, income, expenses } = data
  const flowDays = data.flowDays || {}
  const currencies = data.incomeCurrencies || {}
  const hidden = data._hidden || {}
  const events: CashEvent[] = []

  // Books-linked rows come with day-level events already; skip their month cells.
  const linkedIncome = data.linked?.income ?? {}
  const linkedExpenses = data.linked?.expenses ?? {}
  for (const e of data.bookEvents ?? []) {
    if (hidden[e.section]?.[e.row]) continue
    const [y, m, d] = e.date.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    events.push({ date, t: date.getTime(), amount: e.section === 'income' ? e.amount : -e.amount, label: `${e.row} · ${e.label}`, section: e.section, monthIdx: e.monthIndex, day: d })
  }

  months.forEach((label, monthIdx) => {
    const p = parseMonthLabel(label)
    if (!p) return
    for (const [k, arr] of Object.entries(income)) {
      if (!arr || k.startsWith('_') || hidden.income?.[k] || linkedIncome[k]) continue
      const v = resolveValue(arr[monthIdx], data, monthIdx)
      if (!v) continue
      const amount = convertToCAD(v, currencies[k] || 'CAD', rates)
      const day = effectiveDay(flowDays, 'income', k, monthIdx, label)
      const date = new Date(p.year, p.month, day)
      events.push({ date, t: date.getTime(), amount, label: k, section: 'income', monthIdx, day })
    }
    for (const [k, arr] of Object.entries(expenses)) {
      if (!arr || k.startsWith('_') || hidden.expenses?.[k] || linkedExpenses[k]) continue
      const v = resolveValue(arr[monthIdx], data, monthIdx)
      if (!v) continue
      const day = effectiveDay(flowDays, 'expenses', k, monthIdx, label)
      const date = new Date(p.year, p.month, day)
      events.push({ date, t: date.getTime(), amount: -v, label: k, section: 'expenses', monthIdx, day })
    }
  })

  events.sort((a, b) => a.t - b.t || (a.section === b.section ? 0 : a.section === 'income' ? -1 : 1))
  return events
}

export function pickAnchor(data: ForecastData): Anchor | null {
  const snaps: Record<string, { amount: number; day: number }> = { ...(data.bankBalances || {}) }
  if (data.linkedBank && !snaps[String(data.linkedBank.monthIndex)]) snaps[String(data.linkedBank.monthIndex)] = { amount: data.linkedBank.amount, day: data.linkedBank.day }
  let best: Anchor | null = null
  for (const [idx, snap] of Object.entries(snaps)) {
    const i = Number(idx)
    const p = parseMonthLabel(data.months[i])
    if (!p || !snap) continue
    const day = Math.min(snap.day || 1, daysInMonth(p))
    const date = new Date(p.year, p.month, day)
    if (!best || date.getTime() > best.t) best = { amount: snap.amount, date, t: date.getTime(), monthIdx: i, day }
  }
  return best
}

export function computeBase(events: CashEvent[], anchor: Anchor | null): number {
  if (!anchor) return 0
  let sum = 0
  for (const e of events) {
    if (e.t <= anchor.t) sum += e.amount
    else break
  }
  return anchor.amount - sum
}

export interface AnnotatedEvent extends CashEvent { balance: number }

export function withRunningBalance(events: CashEvent[], base: number): AnnotatedEvent[] {
  let run = base
  return events.map((e) => { run += e.amount; return { ...e, balance: run } })
}

export function balanceAt(base: number, events: CashEvent[], target: Date | number): number {
  const t = target instanceof Date ? target.getTime() : target
  let bal = base
  for (const e of events) {
    if (e.t <= t) bal += e.amount
    else break
  }
  return bal
}

export interface DayGroup { key: string; date: Date; events: AnnotatedEvent[]; balance: number; isAnchor?: boolean; isToday?: boolean }

export function groupByDay(annotated: AnnotatedEvent[], fromMs: number, toMs: number): DayGroup[] {
  const groups: DayGroup[] = []
  let cur: DayGroup | null = null
  for (const e of annotated) {
    if (e.t < fromMs || e.t > toMs) continue
    const key = `${e.date.getFullYear()}-${e.date.getMonth()}-${e.date.getDate()}`
    if (!cur || cur.key !== key) {
      cur = { key, date: e.date, events: [], balance: e.balance }
      groups.push(cur)
    }
    cur.events.push(e)
    cur.balance = e.balance
  }
  return groups
}
