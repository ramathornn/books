import {
  DEFAULT_FISCAL_YEAR_END,
  fiscalQuarterBounds,
  fiscalQuarterOf,
  fiscalYearBounds,
  fiscalYearOf,
  previousFiscalQuarter,
  type FiscalYearEnd,
} from '@/lib/fiscalYear'

export type ReportPreset =
  | 'this-year'
  | 'last-year'
  | 'this-year-to-date'
  | 'this-quarter'
  | 'last-quarter'
  | 'this-month'
  | 'last-month'
  | 'today'
  | 'this-fiscal-year'
  | 'last-fiscal-year'
  | 'this-fiscal-year-to-date'
  | 'this-fiscal-quarter'
  | 'last-fiscal-quarter'
  | 'custom'

/**
 * All boundaries are **UTC calendar-date instants**: starts at UTC midnight,
 * ends at 23:59:59 UTC. That matches how date-only entry dates are stored (UTC
 * midnight — `new Date('YYYY-MM-DD')`) and how `formatDateLong` renders them.
 * Building boundaries in server-local time instead shifts every range by the
 * UTC offset on a non-UTC box — an Oct 31 as-of then includes Nov-1-dated
 * entries and displays as Nov 1.
 *
 * The business date ("today") is still read off the local clock — the server
 * runs in the company's timezone — and then projected into the UTC domain.
 *
 * `fye` defaults to Dec 31 (the Prisma schema default), which makes every
 * fiscal preset collapse to its calendar twin — so a caller that hasn't threaded
 * the company's fiscal year-end degrades to the calendar behaviour rather than
 * to something wrong. Pass `company.fiscalYearEnd` from `getCompanySettings()`.
 */
export function resolveReportRange(
  key: string | undefined,
  now: Date = new Date(),
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): {
  start: Date
  end: Date
  label: string
  preset: ReportPreset
} {
  const preset = (key || 'this-year') as ReportPreset
  // Local calendar date of `now` = the business day; all instants below are UTC.
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  const todayUtc = new Date(Date.UTC(y, m, d)) // UTC-domain "now" for the fiscal helpers
  const endOfToday = new Date(Date.UTC(y, m, d, 23, 59, 59))

  function fmt(dt: Date) {
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  function rng(start: Date, end: Date): ReturnType<typeof resolveReportRange> {
    return { start, end, label: `${fmt(start)} – ${fmt(end)}`, preset }
  }

  switch (preset) {
    case 'today':
      return rng(todayUtc, endOfToday)
    case 'this-month':
      return rng(new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 0, 23, 59, 59)))
    case 'last-month':
      return rng(new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 0, 23, 59, 59)))
    case 'this-quarter': {
      const q = Math.floor(m / 3) * 3
      return rng(new Date(Date.UTC(y, q, 1)), new Date(Date.UTC(y, q + 3, 0, 23, 59, 59)))
    }
    case 'last-quarter': {
      const q = Math.floor(m / 3) * 3 - 3
      const yy = q < 0 ? y - 1 : y
      const mm = ((q % 12) + 12) % 12
      return rng(new Date(Date.UTC(yy, mm, 1)), new Date(Date.UTC(yy, mm + 3, 0, 23, 59, 59)))
    }
    case 'last-year':
      return rng(new Date(Date.UTC(y - 1, 0, 1)), new Date(Date.UTC(y - 1, 11, 31, 23, 59, 59)))
    case 'this-year-to-date':
      return rng(new Date(Date.UTC(y, 0, 1)), endOfToday)
    case 'this-fiscal-year': {
      const fy = fiscalYearBounds(fiscalYearOf(todayUtc, fye), fye)
      return rng(fy.start, fy.end)
    }
    case 'last-fiscal-year': {
      const fy = fiscalYearBounds(fiscalYearOf(todayUtc, fye) - 1, fye)
      return rng(fy.start, fy.end)
    }
    case 'this-fiscal-year-to-date': {
      const fy = fiscalYearBounds(fiscalYearOf(todayUtc, fye), fye)
      return rng(fy.start, endOfToday)
    }
    case 'this-fiscal-quarter': {
      const { fyYear, quarter } = fiscalQuarterOf(todayUtc, fye)
      const fq = fiscalQuarterBounds(fyYear, quarter, fye)
      return rng(fq.start, fq.end)
    }
    case 'last-fiscal-quarter': {
      const current = fiscalQuarterOf(todayUtc, fye)
      const prev = previousFiscalQuarter(current.fyYear, current.quarter)
      const fq = fiscalQuarterBounds(prev.fyYear, prev.quarter, fye)
      return rng(fq.start, fq.end)
    }
    case 'this-year':
    default:
      return rng(new Date(Date.UTC(y, 0, 1)), new Date(Date.UTC(y, 11, 31, 23, 59, 59)))
  }
}

/**
 * Strict YYYY-MM-DD → UTC-midnight Date. UTC construction matches how the
 * presets above build their boundaries (and how date-only entry dates are
 * stored). Returns null on anything else, including well-formed but impossible
 * dates like 2025-02-30.
 */
function parseDateOnly(raw: string | undefined): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const [y, m, d] = raw.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date
}

/**
 * Resolve an explicit ?start=YYYY-MM-DD&end=YYYY-MM-DD range (inclusive; end runs
 * to 23:59:59 UTC). Returns null unless both params are valid and start ≤ end, so
 * callers can fall back to the preset:
 *
 *   const range = resolveCustomReportRange(p.start, p.end) ?? resolveReportRange(preset)
 */
export function resolveCustomReportRange(
  startRaw: string | undefined,
  endRaw: string | undefined
): { start: Date; end: Date; label: string; preset: ReportPreset } | null {
  const start = parseDateOnly(startRaw)
  const endDay = parseDateOnly(endRaw)
  if (!start || !endDay || start > endDay) return null
  const end = new Date(Date.UTC(endDay.getUTCFullYear(), endDay.getUTCMonth(), endDay.getUTCDate(), 23, 59, 59))
  function fmt(d: Date) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  return { start, end, label: `${fmt(start)} – ${fmt(end)}`, preset: 'custom' }
}
