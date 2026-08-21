import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  monthRangesBetween,
  quarterRangesBetween,
  fiscalQuarterRangesBetween,
} from '@/lib/reports/profitAndLoss'
import { fiscalYearBounds, type FiscalYearEnd } from '@/lib/fiscalYear'

const OCT31: FiscalYearEnd = { month: 10, day: 31 }

/**
 * Period edges are UTC calendar-date instants — the same domain as
 * `reportRange`/`fiscalYear`, matching how date-only entry dates are stored (UTC
 * midnight) — so these tests are deterministic in any process timezone.
 */
const utc = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0) =>
  new Date(Date.UTC(y, m, d, hh, mm, ss))

test('monthRangesBetween: spans calendar months, clipping first and last to the range', () => {
  const months = monthRangesBetween(utc(2024, 10, 11), utc(2025, 8, 30, 23, 59, 59))
  assert.equal(months.length, 11) // Nov 2024 … Sep 2025
  assert.equal(months[0].label, 'Nov 2024')
  assert.deepEqual(months[0].start, utc(2024, 10, 11)) // clipped to range start
  assert.deepEqual(months[0].end, utc(2024, 10, 30, 23, 59, 59))
  assert.equal(months[10].label, 'Sep 2025')
  assert.deepEqual(months[10].start, utc(2025, 8, 1))
  assert.deepEqual(months[10].end, utc(2025, 8, 30, 23, 59, 59)) // clipped to range end
})

test('monthRangesBetween: months tile the range with no gap or overlap', () => {
  const months = monthRangesBetween(utc(2024, 10, 1), utc(2025, 8, 30, 23, 59, 59))
  for (let i = 1; i < months.length; i++) {
    const prevEnd = months[i - 1].end
    const nextStart = months[i].start
    // Next month starts strictly after the previous ends, with no full day lost between.
    assert.ok(nextStart > prevEnd)
    assert.ok(nextStart.getTime() - prevEnd.getTime() <= 1000)
  }
})

test('monthRangesBetween: a first-of-month timestamp belongs to that month, not the prior one', () => {
  const months = monthRangesBetween(utc(2024, 10, 1), utc(2025, 0, 31, 23, 59, 59))
  const dec1 = utc(2024, 11, 1)
  const nov = months.find((m) => m.label === 'Nov 2024')!
  const dec = months.find((m) => m.label === 'Dec 2024')!
  assert.ok(dec1 > nov.end)
  assert.ok(dec1 >= dec.start && dec1 <= dec.end)
})

test('monthRangesBetween: labels read in the UTC domain, not the process timezone', () => {
  // A UTC-midnight Nov 1 is Oct 31 evening anywhere west of Greenwich, so a
  // locally-formatted label would say "Oct 2024" and mislabel the column.
  const months = monthRangesBetween(utc(2024, 10, 1), utc(2024, 10, 30, 23, 59, 59))
  assert.deepEqual(
    months.map((m) => m.label),
    ['Nov 2024']
  )
})

test('monthRangesBetween: single-day and single-month ranges', () => {
  const single = monthRangesBetween(utc(2025, 6, 15), utc(2025, 6, 15, 23, 59, 59))
  assert.equal(single.length, 1)
  assert.equal(single[0].label, 'Jul 2025')
  assert.deepEqual(single[0].start, utc(2025, 6, 15))
  assert.deepEqual(single[0].end, utc(2025, 6, 15, 23, 59, 59))
})

test('monthRangesBetween: crosses a year boundary without skipping or duplicating', () => {
  const months = monthRangesBetween(utc(2024, 10, 1), utc(2025, 1, 28, 23, 59, 59))
  assert.deepEqual(
    months.map((m) => m.label),
    ['Nov 2024', 'Dec 2024', 'Jan 2025', 'Feb 2025']
  )
})

test('monthRangesBetween: empty when end precedes start', () => {
  assert.deepEqual(monthRangesBetween(utc(2025, 5, 1), utc(2025, 4, 1)), [])
})

test('quarterRangesBetween: calendar quarters, clipping first and last to the range', () => {
  // The range behind the CRA GST exhibit: opens mid-Q4 2024, closes mid-Q3 2026.
  const qs = quarterRangesBetween(utc(2024, 10, 11), utc(2026, 6, 31, 23, 59, 59))
  assert.deepEqual(
    qs.map((q) => q.label),
    ['2024 Q4', '2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4', '2026 Q1', '2026 Q2', '2026 Q3']
  )
  // A partial opening quarter is kept, not dropped: Nov 11 → Dec 31.
  assert.deepEqual(qs[0].start, utc(2024, 10, 11))
  assert.deepEqual(qs[0].end, utc(2024, 11, 31, 23, 59, 59))
  // And the closing quarter is clipped to the range end rather than running to Sep 30.
  assert.deepEqual(qs[7].start, utc(2026, 6, 1))
  assert.deepEqual(qs[7].end, utc(2026, 6, 31, 23, 59, 59))
})

test('quarterRangesBetween: buckets align to the calendar, not to the range start', () => {
  // Opening on Feb 5 must still produce a Q1 column (clipped), not a Feb–Apr bucket.
  const qs = quarterRangesBetween(utc(2025, 1, 5), utc(2025, 11, 31, 23, 59, 59))
  assert.deepEqual(
    qs.map((q) => q.label),
    ['2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4']
  )
  assert.deepEqual(qs[0].start, utc(2025, 1, 5))
  assert.deepEqual(qs[1].start, utc(2025, 3, 1))
})

test('quarterRangesBetween: quarters tile the range with no gap or overlap', () => {
  const qs = quarterRangesBetween(utc(2024, 10, 11), utc(2026, 6, 31, 23, 59, 59))
  for (let i = 1; i < qs.length; i++) {
    assert.ok(qs[i].start > qs[i - 1].end)
    assert.ok(qs[i].start.getTime() - qs[i - 1].end.getTime() <= 1000)
  }
})

test('quarterRangesBetween: quarter boundaries coincide with month boundaries', () => {
  // Both series clip to the same range, so the quarters must be an exact
  // regrouping of the months — otherwise the two tabs would disagree.
  const start = utc(2024, 10, 11)
  const end = utc(2026, 6, 31, 23, 59, 59)
  const months = monthRangesBetween(start, end)
  const qs = quarterRangesBetween(start, end)
  const monthStarts = months.map((m) => m.start.getTime())
  const monthEnds = months.map((m) => m.end.getTime())
  for (const q of qs) {
    assert.ok(monthStarts.includes(q.start.getTime()), `${q.label} start is a month start`)
    assert.ok(monthEnds.includes(q.end.getTime()), `${q.label} end is a month end`)
  }
  assert.deepEqual(qs[0].start, months[0].start)
  assert.deepEqual(qs[qs.length - 1].end, months[months.length - 1].end)
})

test('quarterRangesBetween: single-day range, and empty when end precedes start', () => {
  const single = quarterRangesBetween(utc(2025, 6, 15), utc(2025, 6, 15, 23, 59, 59))
  assert.equal(single.length, 1)
  assert.equal(single[0].label, '2025 Q3')
  assert.deepEqual(single[0].start, utc(2025, 6, 15))
  assert.deepEqual(single[0].end, utc(2025, 6, 15, 23, 59, 59))
  assert.deepEqual(quarterRangesBetween(utc(2025, 5, 1), utc(2025, 4, 1)), [])
})

test('fiscalQuarterRangesBetween: an Oct 31 year-end shifts the quarters off the calendar', () => {
  const fy2026 = fiscalYearBounds(2026, OCT31)
  const qs = fiscalQuarterRangesBetween(fy2026.start, fy2026.end, OCT31)
  assert.deepEqual(
    qs.map((q) => q.label),
    ['FY2026 Q1', 'FY2026 Q2', 'FY2026 Q3', 'FY2026 Q4']
  )
  // FY2026 Q1 = Nov 1 2025 → Jan 31 2026.
  assert.deepEqual(qs[0].start, utc(2025, 10, 1))
  assert.deepEqual(qs[0].end, utc(2026, 0, 31, 23, 59, 59))
  // The four quarters tile the fiscal year exactly — this is what makes the
  // Total column tie to the fiscal-year P&L, which calendar quarters never do.
  assert.deepEqual(qs[0].start, fy2026.start)
  assert.deepEqual(qs[3].end, fy2026.end)
  for (let i = 1; i < qs.length; i++) {
    assert.ok(qs[i].start > qs[i - 1].end)
    assert.ok(qs[i].start.getTime() - qs[i - 1].end.getTime() <= 1000)
  }
})

test('fiscalQuarterRangesBetween: a Dec 31 year-end collapses onto the calendar quarters', () => {
  const start = utc(2025, 0, 1)
  const end = utc(2025, 11, 31, 23, 59, 59)
  const fiscal = fiscalQuarterRangesBetween(start, end, { month: 12, day: 31 })
  const calendar = quarterRangesBetween(start, end)
  assert.equal(fiscal.length, calendar.length)
  fiscal.forEach((f, i) => {
    assert.deepEqual(f.start, calendar[i].start)
    assert.deepEqual(f.end, calendar[i].end)
  })
})

test('fiscalQuarterRangesBetween: rolls across fiscal years and clips both ends', () => {
  const qs = fiscalQuarterRangesBetween(utc(2025, 11, 10), utc(2026, 5, 30, 23, 59, 59), OCT31)
  assert.deepEqual(
    qs.map((q) => q.label),
    ['FY2026 Q1', 'FY2026 Q2', 'FY2026 Q3']
  )
  assert.deepEqual(qs[0].start, utc(2025, 11, 10)) // clipped, not Nov 1
  assert.deepEqual(qs[2].end, utc(2026, 5, 30, 23, 59, 59)) // clipped, not Jul 31
})

test('fiscalQuarterRangesBetween: a mid-month year-end keeps its day across quarters', () => {
  const JUN_15: FiscalYearEnd = { month: 6, day: 15 }
  const fy = fiscalYearBounds(2026, JUN_15)
  const qs = fiscalQuarterRangesBetween(fy.start, fy.end, JUN_15)
  assert.equal(qs.length, 4)
  assert.deepEqual(qs[0].start, utc(2025, 5, 16))
  assert.deepEqual(qs[0].end, utc(2025, 8, 15, 23, 59, 59))
  assert.deepEqual(qs[3].end, fy.end)
})

test('fiscalQuarterRangesBetween: empty when end precedes start', () => {
  assert.deepEqual(fiscalQuarterRangesBetween(utc(2025, 5, 1), utc(2025, 4, 1), OCT31), [])
})
