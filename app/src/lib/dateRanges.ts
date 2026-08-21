export type DateRangeKey =
  | 'this-year'
  | 'last-year'
  | 'this-quarter'
  | 'last-quarter'
  | 'last-12-months'
  | 'last-6-months'
  | 'last-3-months'
  | 'last-30-days'
  | 'this-month'
  | 'last-month'

export interface RangeOption {
  value: DateRangeKey
  label: string
}

export const RANGE_OPTIONS: RangeOption[] = [
  { value: 'this-year', label: 'This Year' },
  { value: 'last-year', label: 'Last Year' },
  { value: 'this-quarter', label: 'This Quarter' },
  { value: 'last-quarter', label: 'Last Quarter' },
  { value: 'last-12-months', label: 'Last 12 Months' },
  { value: 'last-6-months', label: 'Last 6 Months' },
  { value: 'last-3-months', label: 'Last 3 Months' },
  { value: 'last-30-days', label: 'Last 30 Days' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
]

export function isValidRangeKey(value: string): value is DateRangeKey {
  return RANGE_OPTIONS.some((o) => o.value === value)
}

export function resolveDateRange(
  key: DateRangeKey,
  now: Date = new Date()
): { start: Date; end: Date; label: string } {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()

  function fmt(d: Date) {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }
  function range(start: Date, end: Date, prefix = 'for') {
    return { start, end, label: `${prefix} ${fmt(start)} to ${fmt(end)}` }
  }

  switch (key) {
    case 'this-year':
      return range(new Date(year, 0, 1), new Date(year, 11, 31, 23, 59, 59))
    case 'last-year':
      return range(
        new Date(year - 1, 0, 1),
        new Date(year - 1, 11, 31, 23, 59, 59)
      )
    case 'this-quarter': {
      const qStart = Math.floor(month / 3) * 3
      return range(
        new Date(year, qStart, 1),
        new Date(year, qStart + 3, 0, 23, 59, 59)
      )
    }
    case 'last-quarter': {
      const qStart = Math.floor(month / 3) * 3 - 3
      const y = qStart < 0 ? year - 1 : year
      const m = ((qStart % 12) + 12) % 12
      return range(new Date(y, m, 1), new Date(y, m + 3, 0, 23, 59, 59))
    }
    case 'last-12-months':
      return range(
        new Date(year, month - 11, 1),
        new Date(year, month + 1, 0, 23, 59, 59)
      )
    case 'last-6-months':
      return range(
        new Date(year, month - 5, 1),
        new Date(year, month + 1, 0, 23, 59, 59)
      )
    case 'last-3-months':
      return range(
        new Date(year, month - 2, 1),
        new Date(year, month + 1, 0, 23, 59, 59)
      )
    case 'last-30-days': {
      const start = new Date(year, month, day - 29)
      return range(start, new Date(year, month, day, 23, 59, 59))
    }
    case 'this-month':
      return range(
        new Date(year, month, 1),
        new Date(year, month + 1, 0, 23, 59, 59)
      )
    case 'last-month':
      return range(
        new Date(year, month - 1, 1),
        new Date(year, month, 0, 23, 59, 59)
      )
  }
}
