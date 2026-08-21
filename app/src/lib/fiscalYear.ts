/**
 * Fiscal-year calendar math — pure, sync, DB-free.
 *
 * `CompanySettings.fiscalYearEndMonth/Day` describes the company's fiscal year
 * by the month + day it ENDS on (default Dec 31, i.e. the fiscal year is the
 * calendar year). Everything here derives fiscal-year and fiscal-quarter
 * boundaries from that pair so report presets can offer a fiscal set alongside
 * the calendar one.
 *
 * Conventions, matching `lib/cca/service.ts:fiscalYearEndDate` and the CRA:
 *  - a fiscal year is NAMED by the calendar year it ends in — with an Oct 31
 *    year-end, FY2026 runs Nov 1 2025 → Oct 31 2026.
 *  - all boundary instants are built in the **UTC domain**: starts are UTC
 *    midnight and ends are 23:59:59 UTC, matching how date-only entry dates
 *    are stored (UTC midnight) and how `formatDateLong` renders them. Building
 *    boundaries in server-local time shifts them by the UTC offset on any
 *    non-UTC box, which both mislabels statements and sweeps next-day entries
 *    into an as-of balance. `now`-style inputs are therefore also read with
 *    UTC getters — callers holding a wall-clock Date should normalize it to
 *    the business day first (see `resolveReportRange`).
 *
 * No Prisma import: this stays usable from client components and from
 * `npx tsx --test` with no database.
 */

export interface FiscalYearEnd {
  month: number // 1-12
  day: number
}

/** The Prisma schema default — fiscal year ≡ calendar year. */
export const DEFAULT_FISCAL_YEAR_END: FiscalYearEnd = { month: 12, day: 31 }

/** Dec 31 year-end ⇒ every fiscal preset collapses to its calendar twin. */
export function isCalendarFiscalYear(fye: FiscalYearEnd): boolean {
  return fye.month === 12 && fye.day === 31
}

/**
 * Clamp a configured day to the last real day of that month, so a `{month: 4,
 * day: 31}` config lands on Apr 30 and `{month: 2, day: 29}` lands on Feb 28 in
 * a non-leap year. Without this, day overflow silently rolls into the next month.
 */
function clampDay(year: number, month: number, day: number): number {
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return Math.min(day, lastDayOfMonth)
}

/**
 * Longest `month` (1-12) can ever be, across any year — February is **29**, so a
 * Feb-29 year-end stays configurable (it clamps to the 28th in non-leap years,
 * which is the correct reading of "the last day of February").
 *
 * This is the year-independent bound used to validate and to build a day picker;
 * `clampDay` is what resolves a stored config against a specific year.
 */
export function maxDayInMonth(month: number): number {
  // Leap year, so February reports 29.
  return new Date(Date.UTC(2024, month, 0)).getUTCDate()
}

/** Is this a storable year-end? Rejects out-of-range months and impossible days. */
export function isValidFiscalYearEnd(fye: FiscalYearEnd): boolean {
  if (!Number.isInteger(fye.month) || fye.month < 1 || fye.month > 12) return false
  if (!Number.isInteger(fye.day) || fye.day < 1) return false
  return fye.day <= maxDayInMonth(fye.month)
}

/** The last instant of fiscal year `fyYear` (day-clamped), 23:59:59 UTC. */
export function fiscalYearEndOn(
  fyYear: number,
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): Date {
  return new Date(Date.UTC(fyYear, fye.month - 1, clampDay(fyYear, fye.month, fye.day), 23, 59, 59))
}

/** Which fiscal year `now` falls in — named by the calendar year it ends in. */
export function fiscalYearOf(
  now: Date = new Date(),
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): number {
  const y = now.getUTCFullYear()
  const endDay = clampDay(y, fye.month, fye.day)
  const month = now.getUTCMonth() + 1
  // Compared at day granularity so a timestamp late on the year-end day still
  // counts as inside the year that ends that day.
  const pastYearEnd = month > fye.month || (month === fye.month && now.getUTCDate() > endDay)
  return pastYearEnd ? y + 1 : y
}

/** The day after `d`, at UTC midnight. */
function dayAfter(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
}

/** Full bounds of fiscal year `fyYear`: day after the prior year-end → year-end. */
export function fiscalYearBounds(
  fyYear: number,
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): { start: Date; end: Date } {
  return {
    start: dayAfter(fiscalYearEndOn(fyYear - 1, fye)),
    end: fiscalYearEndOn(fyYear, fye),
  }
}

/**
 * End of the k-th quarter of fiscal year `fyYear` (k = 1..4).
 *
 * Computed from an ABSOLUTE month index off the year-end month rather than by
 * adding months to an already-clamped anchor date — otherwise a Feb-28-clamped
 * anchor would drift a Feb-29 config's quarters by a day. Because the day is
 * clamped independently per quarter, `quarterEnd(4) === fiscalYearEndOn(fyYear)`
 * exactly, so the four quarters tile the fiscal year with no gap or overlap.
 */
function quarterEnd(fyYear: number, q: number, fye: FiscalYearEnd): Date {
  const monthIndex = (fyYear - 1) * 12 + (fye.month - 1) + 3 * q
  const year = Math.floor(monthIndex / 12)
  const month = (monthIndex % 12) + 1 // 1-12
  return new Date(Date.UTC(year, month - 1, clampDay(year, month, fye.day), 23, 59, 59))
}

/** Bounds of the q-th quarter (1-4) of fiscal year `fyYear`. */
export function fiscalQuarterBounds(
  fyYear: number,
  q: number,
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): { start: Date; end: Date } {
  // Quarter 0's "end" is the prior fiscal year-end, so Q1 starts the day after it.
  const priorEnd = q === 1 ? fiscalYearEndOn(fyYear - 1, fye) : quarterEnd(fyYear, q - 1, fye)
  return { start: dayAfter(priorEnd), end: quarterEnd(fyYear, q, fye) }
}

/** Which fiscal year + quarter `now` falls in. */
export function fiscalQuarterOf(
  now: Date = new Date(),
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): { fyYear: number; quarter: number } {
  const fyYear = fiscalYearOf(now, fye)
  // Compare at day granularity, matching fiscalYearOf.
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  for (let q = 1; q <= 3; q++) {
    if (today <= quarterEnd(fyYear, q, fye)) return { fyYear, quarter: q }
  }
  return { fyYear, quarter: 4 }
}

/**
 * The fiscal quarter immediately before (`fyYear`, `q`) — Q1 wraps back to Q4
 * of the prior fiscal year.
 */
export function previousFiscalQuarter(
  fyYear: number,
  q: number
): { fyYear: number; quarter: number } {
  return q === 1 ? { fyYear: fyYear - 1, quarter: 4 } : { fyYear, quarter: q - 1 }
}

/*
 * Known edge, deliberately not handled: `lib/priorYearRange.ts` shifts a range
 * back with `setUTCFullYear(y - 1)`, which is correct for every fiscal year-end
 * except a Feb-29 config, where Feb 29 rolls to Mar 1 (standard JS behaviour).
 * Widening that diff isn't worth the pathological config.
 */
