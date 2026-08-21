import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_FISCAL_YEAR_END,
  fiscalQuarterBounds,
  fiscalQuarterOf,
  fiscalYearBounds,
  fiscalYearEndOn,
  fiscalYearOf,
  isCalendarFiscalYear,
  isValidFiscalYearEnd,
  maxDayInMonth,
  previousFiscalQuarter,
  type FiscalYearEnd,
} from '@/lib/fiscalYear'

const OCT31: FiscalYearEnd = { month: 10, day: 31 }

/**
 * Boundaries and inputs are UTC calendar-date instants — these helpers operate
 * in the UTC domain (matching how date-only entry dates are stored: UTC
 * midnight), so the tests are deterministic in any process timezone.
 */
const utc = (y: number, m: number, d: number, hh = 0, mm = 0, ss = 0, ms = 0) =>
  new Date(Date.UTC(y, m, d, hh, mm, ss, ms))

test('isCalendarFiscalYear: only Dec 31 counts as calendar', () => {
  assert.equal(isCalendarFiscalYear(DEFAULT_FISCAL_YEAR_END), true)
  assert.equal(isCalendarFiscalYear({ month: 12, day: 31 }), true)
  assert.equal(isCalendarFiscalYear(OCT31), false)
  assert.equal(isCalendarFiscalYear({ month: 12, day: 30 }), false)
})

test('fiscal year is named by the calendar year it ends in', () => {
  // Oct-31 year-end ⇒ FY2026 = Nov 1 2025 – Oct 31 2026.
  const { start, end } = fiscalYearBounds(2026, OCT31)
  assert.deepEqual(start, utc(2025, 10, 1))
  assert.deepEqual(end, utc(2026, 9, 31, 23, 59, 59))
})

test('fiscalYearOf: the Oct 31 / Nov 1 boundary flips the fiscal year', () => {
  assert.equal(fiscalYearOf(utc(2026, 9, 30), OCT31), 2026)
  assert.equal(fiscalYearOf(utc(2026, 9, 31), OCT31), 2026) // year-end day is inside
  assert.equal(fiscalYearOf(utc(2026, 9, 31, 23, 59, 59, 999), OCT31), 2026)
  assert.equal(fiscalYearOf(utc(2026, 10, 1), OCT31), 2027) // day after → next FY
  assert.equal(fiscalYearOf(utc(2025, 10, 1), OCT31), 2026)
})

test('Dec-31 year-end is identical to the calendar year', () => {
  const { start, end } = fiscalYearBounds(2025, DEFAULT_FISCAL_YEAR_END)
  assert.deepEqual(start, utc(2025, 0, 1))
  assert.deepEqual(end, utc(2025, 11, 31, 23, 59, 59))
  assert.equal(fiscalYearOf(utc(2025, 0, 1), DEFAULT_FISCAL_YEAR_END), 2025)
  assert.equal(fiscalYearOf(utc(2025, 11, 31), DEFAULT_FISCAL_YEAR_END), 2025)

  // Its quarters are the calendar quarters.
  assert.deepEqual(fiscalQuarterBounds(2025, 1, DEFAULT_FISCAL_YEAR_END), {
    start: utc(2025, 0, 1),
    end: utc(2025, 2, 31, 23, 59, 59),
  })
  assert.deepEqual(fiscalQuarterBounds(2025, 4, DEFAULT_FISCAL_YEAR_END), {
    start: utc(2025, 9, 1),
    end: utc(2025, 11, 31, 23, 59, 59),
  })
})

test('day clamping: a day past the end of the month lands on the last day', () => {
  // {month: 4, day: 31} → Apr 30, not May 1.
  assert.deepEqual(fiscalYearEndOn(2026, { month: 4, day: 31 }), utc(2026, 3, 30, 23, 59, 59))
  // Feb 29 → Feb 28 in a non-leap year, Feb 29 in a leap year.
  assert.deepEqual(fiscalYearEndOn(2025, { month: 2, day: 29 }), utc(2025, 1, 28, 23, 59, 59))
  assert.deepEqual(fiscalYearEndOn(2024, { month: 2, day: 29 }), utc(2024, 1, 29, 23, 59, 59))
})

test('a Feb-29 fiscal year spans a clamped prior year-end cleanly', () => {
  // FY2026 ends Feb 28 2026 and starts the day after Feb 28 2025 (clamped) = Mar 1 2025.
  const { start, end } = fiscalYearBounds(2026, { month: 2, day: 29 })
  assert.deepEqual(start, utc(2025, 2, 1))
  assert.deepEqual(end, utc(2026, 1, 28, 23, 59, 59))
})

test('non-month-end year-end: Jun 15 ⇒ fiscal year starts Jun 16', () => {
  const fye: FiscalYearEnd = { month: 6, day: 15 }
  const { start, end } = fiscalYearBounds(2026, fye)
  assert.deepEqual(start, utc(2025, 5, 16))
  assert.deepEqual(end, utc(2026, 5, 15, 23, 59, 59))

  // Q1 = Jun 16 – Sep 15 2025.
  assert.deepEqual(fiscalQuarterBounds(2026, 1, fye), {
    start: utc(2025, 5, 16),
    end: utc(2025, 8, 15, 23, 59, 59),
  })
})

test('boundaries are exact UTC instants in any server timezone', () => {
  // Regression: local-time construction on a UTC−6/−7 box pushed every
  // boundary hours into the next UTC day, so an Oct-31 year-end statement
  // included Nov-1-dated entries. Pin the raw instants.
  const { start, end } = fiscalYearBounds(2026, OCT31)
  assert.equal(start.toISOString(), '2025-11-01T00:00:00.000Z')
  assert.equal(end.toISOString(), '2026-10-31T23:59:59.000Z')
  // A date-only JE stored at UTC midnight of Nov 1 2026 is OUTSIDE FY2026.
  assert.ok(new Date('2026-11-01T00:00:00Z') > end)
  // And one at UTC midnight of Nov 1 2025 is the first instant INSIDE it.
  assert.ok(new Date('2025-11-01T00:00:00Z') >= start)
})

test('the four quarters tile the fiscal year exactly', () => {
  for (const fye of [
    OCT31,
    DEFAULT_FISCAL_YEAR_END,
    { month: 6, day: 15 },
    { month: 2, day: 29 },
    { month: 4, day: 31 },
    { month: 3, day: 31 },
  ] as FiscalYearEnd[]) {
    for (const fyYear of [2024, 2025, 2026]) {
      const year = fiscalYearBounds(fyYear, fye)
      const quarters = [1, 2, 3, 4].map((q) => fiscalQuarterBounds(fyYear, q, fye))

      assert.deepEqual(quarters[0].start, year.start, `Q1 start === FY start (${fye.month}/${fye.day} FY${fyYear})`)
      assert.deepEqual(quarters[3].end, year.end, `Q4 end === FY end (${fye.month}/${fye.day} FY${fyYear})`)

      // No gap, no overlap: each quarter starts the day after the prior one ends.
      for (let i = 1; i < 4; i++) {
        const prevEnd = quarters[i - 1].end
        assert.deepEqual(
          quarters[i].start,
          utc(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), prevEnd.getUTCDate() + 1),
          `Q${i + 1} starts the day after Q${i} (${fye.month}/${fye.day} FY${fyYear})`
        )
      }
    }
  }
})

test('Oct-31 fiscal quarters run Nov / Feb / May / Aug', () => {
  assert.deepEqual(fiscalQuarterBounds(2026, 1, OCT31), {
    start: utc(2025, 10, 1),
    end: utc(2026, 0, 31, 23, 59, 59),
  })
  assert.deepEqual(fiscalQuarterBounds(2026, 2, OCT31), {
    start: utc(2026, 1, 1),
    end: utc(2026, 3, 30, 23, 59, 59), // day 31 clamped to Apr 30
  })
  assert.deepEqual(fiscalQuarterBounds(2026, 3, OCT31), {
    start: utc(2026, 4, 1),
    end: utc(2026, 6, 31, 23, 59, 59),
  })
  assert.deepEqual(fiscalQuarterBounds(2026, 4, OCT31), {
    start: utc(2026, 7, 1),
    end: utc(2026, 9, 31, 23, 59, 59),
  })
})

test('fiscalQuarterOf locates a date in the right fiscal quarter', () => {
  assert.deepEqual(fiscalQuarterOf(utc(2025, 10, 1), OCT31), { fyYear: 2026, quarter: 1 })
  assert.deepEqual(fiscalQuarterOf(utc(2026, 0, 31), OCT31), { fyYear: 2026, quarter: 1 })
  assert.deepEqual(fiscalQuarterOf(utc(2026, 1, 1), OCT31), { fyYear: 2026, quarter: 2 })
  assert.deepEqual(fiscalQuarterOf(utc(2026, 6, 15), OCT31), { fyYear: 2026, quarter: 3 })
  assert.deepEqual(fiscalQuarterOf(utc(2026, 9, 31), OCT31), { fyYear: 2026, quarter: 4 })
  assert.deepEqual(fiscalQuarterOf(utc(2026, 10, 1), OCT31), { fyYear: 2027, quarter: 1 })
})

test('previousFiscalQuarter wraps Q1 back to the prior FY Q4', () => {
  assert.deepEqual(previousFiscalQuarter(2026, 3), { fyYear: 2026, quarter: 2 })
  assert.deepEqual(previousFiscalQuarter(2026, 1), { fyYear: 2025, quarter: 4 })
})

test('maxDayInMonth is year-independent, with February at 29', () => {
  const expected = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  for (let m = 1; m <= 12; m++) {
    assert.equal(maxDayInMonth(m), expected[m - 1], `month ${m}`)
  }
})

test('isValidFiscalYearEnd accepts every real year-end and rejects impossible ones', () => {
  assert.equal(isValidFiscalYearEnd({ month: 12, day: 31 }), true)
  assert.equal(isValidFiscalYearEnd({ month: 10, day: 31 }), true)
  assert.equal(isValidFiscalYearEnd({ month: 6, day: 15 }), true)
  assert.equal(isValidFiscalYearEnd({ month: 2, day: 29 }), true) // clamps in non-leap years

  assert.equal(isValidFiscalYearEnd({ month: 2, day: 30 }), false)
  assert.equal(isValidFiscalYearEnd({ month: 4, day: 31 }), false) // April has 30
  assert.equal(isValidFiscalYearEnd({ month: 0, day: 1 }), false)
  assert.equal(isValidFiscalYearEnd({ month: 13, day: 1 }), false)
  assert.equal(isValidFiscalYearEnd({ month: 1, day: 0 }), false)
  assert.equal(isValidFiscalYearEnd({ month: 1.5, day: 1 }), false)
  assert.equal(isValidFiscalYearEnd({ month: 1, day: 2.5 }), false)
})

test('every day accepted by isValidFiscalYearEnd survives a round trip unclamped', () => {
  // A config the picker allows must mean what it says in at least one year —
  // otherwise the UI would be offering a value it silently rewrites.
  for (let m = 1; m <= 12; m++) {
    const day = maxDayInMonth(m)
    assert.equal(isValidFiscalYearEnd({ month: m, day }), true)
    const leapYearEnd = fiscalYearEndOn(2024, { month: m, day }) // 2024 is a leap year
    assert.equal(leapYearEnd.getUTCMonth() + 1, m)
    assert.equal(leapYearEnd.getUTCDate(), day)
  }
})

test('every helper defaults to a Dec-31 year-end when none is given', () => {
  assert.deepEqual(fiscalYearEndOn(2025), fiscalYearEndOn(2025, DEFAULT_FISCAL_YEAR_END))
  assert.equal(fiscalYearOf(utc(2025, 5, 1)), 2025)
  assert.deepEqual(fiscalYearBounds(2025), fiscalYearBounds(2025, DEFAULT_FISCAL_YEAR_END))
  assert.deepEqual(fiscalQuarterBounds(2025, 2), fiscalQuarterBounds(2025, 2, DEFAULT_FISCAL_YEAR_END))
  assert.deepEqual(fiscalQuarterOf(utc(2025, 5, 1)), { fyYear: 2025, quarter: 2 })
})
