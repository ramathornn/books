import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveCustomReportRange, resolveReportRange } from '@/lib/reportRange'
import { DEFAULT_FISCAL_YEAR_END, type FiscalYearEnd } from '@/lib/fiscalYear'

const OCT31: FiscalYearEnd = { month: 10, day: 31 }

/**
 * All range boundaries are UTC calendar-date instants (matching how date-only
 * entry dates are stored: UTC midnight), so expectations are built with
 * Date.UTC. `now` inputs stay locally-constructed — resolveReportRange reads
 * the business date off the local clock — and a local-midnight Date yields the
 * same calendar date in every timezone, so the tests are TZ-independent.
 */
const utc = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) =>
  new Date(Date.UTC(y, m, d, hh, mm, ss))

test('custom range: valid start/end resolves inclusively', () => {
  const r = resolveCustomReportRange('2024-11-01', '2025-09-30')
  assert.ok(r)
  assert.equal(r.preset, 'custom')
  assert.deepEqual(r.start, utc(2024, 10, 1))
  assert.deepEqual(r.end, utc(2025, 8, 30, 23, 59, 59))
  assert.equal(r.label, 'Nov 1, 2024 – Sep 30, 2025')
})

test('custom range: end date is inclusive to end of day', () => {
  const r = resolveCustomReportRange('2025-07-31', '2025-07-31')
  assert.ok(r)
  // A timestamp late on the end day still falls inside the range.
  const lateSameDay = utc(2025, 6, 31, 23, 0, 0)
  assert.ok(lateSameDay >= r.start && lateSameDay <= r.end)
})

test('custom range boundaries are exact UTC instants in any server timezone', () => {
  // Regression: a fiscal year-end range entered as 2025-10-01 → 2025-10-31.
  // On a non-UTC server the old local-time construction pushed the end to
  // 2025-11-01T05:59:59Z, which displayed as Nov 1 AND swept in JEs dated
  // Nov 1 (stored at UTC midnight) — the balance sheet literally showed the
  // Nov 1 position. Boundaries must be UTC instants regardless of process TZ.
  const r = resolveCustomReportRange('2025-10-01', '2025-10-31')
  assert.ok(r)
  assert.equal(r.start.toISOString(), '2025-10-01T00:00:00.000Z')
  assert.equal(r.end.toISOString(), '2025-10-31T23:59:59.000Z')
  // A date-only JE on the first day (UTC midnight) is inside the range…
  assert.ok(new Date('2025-10-01T00:00:00Z') >= r.start)
  // …and one dated the day after the end is NOT.
  assert.ok(new Date('2025-11-01T00:00:00Z') > r.end)
  assert.equal(r.label, 'Oct 1, 2025 – Oct 31, 2025')
})

test('custom range: rejects missing, malformed, impossible, and inverted inputs', () => {
  assert.equal(resolveCustomReportRange(undefined, '2025-09-30'), null)
  assert.equal(resolveCustomReportRange('2024-11-01', undefined), null)
  assert.equal(resolveCustomReportRange('11/01/2024', '2025-09-30'), null)
  assert.equal(resolveCustomReportRange('2024-11-1', '2025-09-30'), null)
  assert.equal(resolveCustomReportRange('2025-02-30', '2025-03-31'), null) // impossible date
  assert.equal(resolveCustomReportRange('2025-09-30', '2024-11-01'), null) // inverted
})

test('custom range: falls back cleanly via ?? to a preset', () => {
  const now = new Date(2025, 6, 15)
  const r = resolveCustomReportRange(undefined, undefined) ?? resolveReportRange('this-month', now)
  assert.equal(r.preset, 'this-month')
  assert.deepEqual(r.start, utc(2025, 6, 1))
})

// ── Calendar presets: pinned so the fiscal work can't move them ──────────────

test('calendar presets are unchanged, with or without a fiscal year-end', () => {
  const now = new Date(2026, 1, 12) // Thu Feb 12 2026
  const expected: Record<string, { start: Date; end: Date }> = {
    today: { start: utc(2026, 1, 12), end: utc(2026, 1, 12, 23, 59, 59) },
    'this-month': { start: utc(2026, 1, 1), end: utc(2026, 1, 28, 23, 59, 59) },
    'last-month': { start: utc(2026, 0, 1), end: utc(2026, 0, 31, 23, 59, 59) },
    'this-quarter': { start: utc(2026, 0, 1), end: utc(2026, 2, 31, 23, 59, 59) },
    'last-quarter': { start: utc(2025, 9, 1), end: utc(2025, 11, 31, 23, 59, 59) },
    'this-year': { start: utc(2026, 0, 1), end: utc(2026, 11, 31, 23, 59, 59) },
    'last-year': { start: utc(2025, 0, 1), end: utc(2025, 11, 31, 23, 59, 59) },
  }
  for (const [key, want] of Object.entries(expected)) {
    const bare = resolveReportRange(key, now)
    assert.deepEqual({ start: bare.start, end: bare.end }, want, key)
    assert.equal(bare.preset, key, key)
    // An Oct-31 fiscal year-end must not perturb a calendar preset.
    const withFye = resolveReportRange(key, now, OCT31)
    assert.deepEqual({ start: withFye.start, end: withFye.end }, want, `${key} + fye`)
  }
})

test('an unknown preset key still falls through to this-year', () => {
  const now = new Date(2026, 1, 12)
  const r = resolveReportRange('not-a-preset', now, OCT31)
  assert.deepEqual(r.start, utc(2026, 0, 1))
  assert.deepEqual(r.end, utc(2026, 11, 31, 23, 59, 59))
})

test('this-year-to-date runs Jan 1 to end of today', () => {
  const now = new Date(2026, 1, 12, 9, 30)
  const r = resolveReportRange('this-year-to-date', now)
  assert.deepEqual(r.start, utc(2026, 0, 1))
  assert.deepEqual(r.end, utc(2026, 1, 12, 23, 59, 59))
  assert.equal(r.label, 'Jan 1, 2026 – Feb 12, 2026')
})

// ── Fiscal presets (Oct 31 year-end) ────────────────────────────────────────

test('fiscal presets resolve against an Oct-31 year-end', () => {
  const now = new Date(2026, 1, 12) // Feb 12 2026 → FY2026, Q2
  const cases: Record<string, { start: Date; end: Date }> = {
    // FY2026 = Nov 1 2025 – Oct 31 2026.
    'this-fiscal-year': { start: utc(2025, 10, 1), end: utc(2026, 9, 31, 23, 59, 59) },
    'last-fiscal-year': { start: utc(2024, 10, 1), end: utc(2025, 9, 31, 23, 59, 59) },
    'this-fiscal-year-to-date': { start: utc(2025, 10, 1), end: utc(2026, 1, 12, 23, 59, 59) },
    // Q2 of FY2026 = Feb 1 – Apr 30 2026; Q1 = Nov 1 2025 – Jan 31 2026.
    'this-fiscal-quarter': { start: utc(2026, 1, 1), end: utc(2026, 3, 30, 23, 59, 59) },
    'last-fiscal-quarter': { start: utc(2025, 10, 1), end: utc(2026, 0, 31, 23, 59, 59) },
  }
  for (const [key, want] of Object.entries(cases)) {
    const r = resolveReportRange(key, now, OCT31)
    assert.deepEqual({ start: r.start, end: r.end }, want, key)
    assert.equal(r.preset, key, key)
  }
})

test('this-fiscal-year label reads as the fiscal span', () => {
  const r = resolveReportRange('this-fiscal-year', new Date(2026, 1, 12), OCT31)
  assert.equal(r.label, 'Nov 1, 2025 – Oct 31, 2026')
})

test('the Oct 31 / Nov 1 boundary moves the fiscal year forward', () => {
  const onYearEnd = resolveReportRange('this-fiscal-year', new Date(2026, 9, 31), OCT31)
  const dayAfter = resolveReportRange('this-fiscal-year', new Date(2026, 10, 1), OCT31)
  assert.deepEqual(onYearEnd.end, utc(2026, 9, 31, 23, 59, 59)) // FY2026
  assert.deepEqual(dayAfter.start, utc(2026, 10, 1)) // FY2027
  assert.deepEqual(dayAfter.end, utc(2027, 9, 31, 23, 59, 59))
  assert.notDeepEqual(onYearEnd.start, dayAfter.start)
})

test('last-fiscal-quarter wraps back into the prior fiscal year', () => {
  // Dec 15 2025 is in FY2026 Q1 (Nov 1 2025 – Jan 31 2026), so the previous
  // quarter is FY2025 Q4 = Aug 1 – Oct 31 2025.
  const r = resolveReportRange('last-fiscal-quarter', new Date(2025, 11, 15), OCT31)
  assert.deepEqual(r.start, utc(2025, 7, 1))
  assert.deepEqual(r.end, utc(2025, 9, 31, 23, 59, 59))
})

test('fiscal presets with no fye argument equal their calendar twins', () => {
  const twins: Array<[string, string]> = [
    ['this-fiscal-year', 'this-year'],
    ['last-fiscal-year', 'last-year'],
    ['this-fiscal-year-to-date', 'this-year-to-date'],
    ['this-fiscal-quarter', 'this-quarter'],
    ['last-fiscal-quarter', 'last-quarter'],
  ]
  for (const now of [new Date(2026, 1, 12), new Date(2025, 11, 31), new Date(2026, 0, 1)]) {
    for (const [fiscal, calendar] of twins) {
      const f = resolveReportRange(fiscal, now)
      const c = resolveReportRange(calendar, now)
      assert.deepEqual({ start: f.start, end: f.end }, { start: c.start, end: c.end }, `${fiscal} ≡ ${calendar}`)
      // Explicitly passing the Dec-31 default must behave the same.
      const fExplicit = resolveReportRange(fiscal, now, DEFAULT_FISCAL_YEAR_END)
      assert.deepEqual({ start: fExplicit.start, end: fExplicit.end }, { start: c.start, end: c.end })
    }
  }
})
