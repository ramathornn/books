// Day-of-month assignment for income / expense cells (drives the daily
// cash-flow timeline). Resolution for a cell: override → latest schedule point
// with from <= monthIdx → fallback (last day of month).

import type { FlowDays, FlowDayValue, Section } from './types'
import { daysInMonth } from './months'

export { parseMonthLabel, daysInMonth } from './months'

function pick(flowDays: FlowDays | undefined, section: Section, row: string, monthIdx: number): FlowDayValue | null {
  const rec = flowDays?.[section]?.[row]
  if (!rec) return null
  const ov = rec.overrides?.[String(monthIdx)]
  if (ov !== undefined && ov !== null) return ov
  if (Array.isArray(rec.schedule) && rec.schedule.length) {
    let best: { from: number; day: FlowDayValue } | null = null
    for (const pt of rec.schedule) {
      if (pt.from <= monthIdx && (best === null || pt.from > best.from)) best = pt
    }
    if (best) return best.day
  }
  return null
}

/** Concrete 1-31 day a cell lands on, clamped to the month length. */
export function effectiveDay(flowDays: FlowDays | undefined, section: Section, row: string, monthIdx: number, monthLabel: string): number {
  const dim = daysInMonth(monthLabel)
  const raw = pick(flowDays, section, row, monthIdx) ?? 'last'
  if (raw === 'last') return dim
  return Math.min(Math.max(1, raw), dim)
}

/** The explicitly assigned day ('last', a number) or null when falling back. */
export function assignedDay(flowDays: FlowDays | undefined, section: Section, row: string, monthIdx: number): FlowDayValue | null {
  return pick(flowDays, section, row, monthIdx)
}

export function hasAssignedDay(flowDays: FlowDays | undefined, section: Section, row: string, monthIdx: number): boolean {
  return pick(flowDays, section, row, monthIdx) !== null
}

export function dayLabel(day: FlowDayValue | null | undefined): string {
  if (day === 'last' || day === null || day === undefined) return 'Last day'
  const n = Number(day)
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Pure updater: set the day for a cell. scope 'month' = one-off override; 'onward' = recurring from this month. */
export function setFlowDay(flowDays: FlowDays | undefined, section: Section, row: string, monthIdx: number, day: FlowDayValue, scope: 'month' | 'onward'): FlowDays {
  const next: FlowDays = JSON.parse(JSON.stringify(flowDays || {}))
  const sec = (next[section] ||= {})
  const rec = (sec[row] ||= { schedule: [], overrides: {} })
  rec.schedule ||= []
  rec.overrides ||= {}
  if (scope === 'onward') {
    rec.schedule = rec.schedule.filter((pt) => pt.from !== monthIdx)
    rec.schedule.push({ from: monthIdx, day })
    rec.schedule.sort((a, b) => a.from - b.from)
    delete rec.overrides[String(monthIdx)]
  } else {
    rec.overrides[String(monthIdx)] = day
  }
  return next
}

/** Pure updater: clear any assignment at this month (reverts to last-day fallback). */
export function clearFlowDay(flowDays: FlowDays | undefined, section: Section, row: string, monthIdx: number): FlowDays {
  const next: FlowDays = JSON.parse(JSON.stringify(flowDays || {}))
  const rec = next[section]?.[row]
  if (!rec) return next
  if (rec.overrides) delete rec.overrides[String(monthIdx)]
  if (rec.schedule) rec.schedule = rec.schedule.filter((pt) => pt.from !== monthIdx)
  return next
}
