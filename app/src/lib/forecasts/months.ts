// Month label helpers. Labels are "Mon'YY" (e.g. "Jan'26"), matching WealthPilot
// so formulas like =income.Salary.Feb'26 keep working.

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month]}'${String(year).slice(-2)}`
}

/** Parse "Mon'YY" → { year (4-digit), month (0-11) } or null. */
export function parseMonthLabel(label: string | null | undefined): { year: number; month: number } | null {
  if (!label) return null
  const m = label.match(/^(\w+)'(\d+)$/)
  if (!m) return null
  const month = MONTH_NAMES.indexOf(m[1])
  if (month < 0) return null
  return { year: 2000 + parseInt(m[2], 10), month }
}

/** Build the contiguous label range for a scenario. */
export function buildMonths(startYear: number, startMonth: number, count: number): string[] {
  const out: string[] = []
  let y = startYear
  let m = startMonth
  for (let i = 0; i < count; i++) {
    out.push(monthLabel(y, m))
    m++
    if (m >= 12) { m = 0; y++ }
  }
  return out
}

/** Shift "Feb'26" by offset months → "Mar'26". Non-labels pass through. */
export function shiftMonthLabel(label: string, offset: number): string {
  const p = parseMonthLabel(label)
  if (!p) return label
  let mi = p.month + offset
  let yr = p.year
  while (mi >= 12) { mi -= 12; yr++ }
  while (mi < 0) { mi += 12; yr-- }
  return monthLabel(yr, mi)
}

export function daysInMonth(labelOrObj: string | { year: number; month: number } | null): number {
  const p = typeof labelOrObj === 'string' ? parseMonthLabel(labelOrObj) : labelOrObj
  if (!p) return 30
  return new Date(p.year, p.month + 1, 0).getDate()
}

/** Index of the current calendar month in `months`, falling back to the latest past month. */
export function currentMonthIndex(months: string[], now: Date = new Date()): number {
  const target = monthLabel(now.getFullYear(), now.getMonth())
  const exact = months.indexOf(target)
  if (exact >= 0) return exact
  const todayKey = now.getFullYear() * 12 + now.getMonth()
  let best = -1
  let bestDiff = Infinity
  months.forEach((m, i) => {
    const p = parseMonthLabel(m)
    if (!p) return
    const diff = todayKey - (p.year * 12 + p.month)
    if (diff >= 0 && diff < bestDiff) { bestDiff = diff; best = i }
  })
  return best >= 0 ? best : Math.max(0, months.length - 1)
}

/** Absolute index a label would have if the range were extended (may exceed months.length-1). -1 if before the range. */
export function monthTargetIndex(months: string[], label: string): number {
  const idx = months.indexOf(label)
  if (idx >= 0) return idx
  const t = parseMonthLabel(label)
  const first = parseMonthLabel(months[0])
  if (!t || !first) return -1
  const diff = (t.year - first.year) * 12 + (t.month - first.month)
  return diff < 0 ? -1 : diff
}
