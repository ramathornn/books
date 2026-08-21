import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeGifi, type GifiDetailBalance } from '@/lib/tax/t2/computeGifi'
import {
  GIFI_TOTAL_LIAB_AND_EQUITY,
  GIFI_NET_INCOME_AFTER_TAX,
  GIFI_NET_BEFORE_TAX,
  GIFI_TOTAL_REVENUE,
  GIFI_TOTAL_EXPENSES,
  GIFI_RETAINED_EARNINGS,
} from '@/lib/tax/t2/gifiCodes'

/**
 * GENERIC balanced trial balance — round figures only, never real data.
 *
 * Scenario: a CCPC whose books, PRE-CLOSE, show
 *   Assets  100,000  =  Liabilities 40,000  +  Equity 60,000
 *
 * Income statement (pre-close):
 *   Revenue  8000 = 150,000
 *   Expenses 8521 =  90,000   (advertising, generic)
 *   Tax      9990 =  10,000   (book tax provision)
 *   ⇒ 9970 (before tax) = 60,000 ; 9999 (after tax) = 50,000
 *
 * Equity side:
 *   Common shares 3500 = 10,000
 *   Retained earnings opening = 5,000 ; dividends declared = 0
 *   ⇒ RE-end (3600) = 5,000 + 50,000 − 0 = 55,000
 *   ⇒ Equity (3620) = 10,000 + 55,000 = 65,000
 *
 * For the balance sheet to balance (Assets 100,000 = Liab 40,000 + Equity 60,000)
 * equity must be 60,000, so we size the ASSET side to whatever equity the
 * continuity produces. We pin assets = liabilities + (shares + RE-end) so the
 * identity holds exactly with NO plug, then perturb by $1 to exercise the plug.
 */

const REVENUE = 150000
const EXPENSES = 90000
const TAX = 10000
const NET_BEFORE_TAX = REVENUE - EXPENSES // 60,000
const NET_AFTER_TAX = NET_BEFORE_TAX - TAX // 50,000

const RE_OPENING = 5000
const DIVIDENDS = 0
const SHARES = 10000
const RE_END = RE_OPENING + NET_AFTER_TAX - DIVIDENDS // 55,000
const EQUITY = SHARES + RE_END // 65,000
const LIABILITIES = 40000
const ASSETS = LIABILITIES + EQUITY // 105,000 — balanced by construction

/** Build the standard balanced detail set (no plug needed). */
function balancedDetails(): GifiDetailBalance[] {
  return [
    // Balance sheet
    { code: '1001', amount: ASSETS, accountIds: ['acc-cash'] }, // total assets in one account
    { code: '2620', amount: LIABILITIES, accountIds: ['acc-ap'] },
    { code: '3500', amount: SHARES, accountIds: ['acc-shares'] },
    { code: GIFI_RETAINED_EARNINGS, amount: 99999, accountIds: ['acc-re'] }, // IGNORED; recomputed
    // Income statement (PRE-CLOSE)
    { code: '8000', amount: REVENUE, accountIds: ['acc-sales'] },
    { code: '8521', amount: EXPENSES, accountIds: ['acc-adv'] },
    { code: '9990', amount: TAX, accountIds: ['acc-tax'] },
  ]
}

test('balanced TB: subtotals computed in-engine, gates pass, no plug', () => {
  const r = computeGifi({
    details: balancedDetails(),
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIVIDENDS,
    closingEntryPosted: false,
  })

  // Income statement subtotals are COMPUTED, not pulled.
  assert.equal(r.lines[GIFI_TOTAL_REVENUE].amount, REVENUE)
  assert.equal(r.lines[GIFI_TOTAL_EXPENSES].amount, EXPENSES)
  assert.equal(r.lines[GIFI_NET_BEFORE_TAX].amount, NET_BEFORE_TAX)
  assert.equal(r.netIncome9999, NET_AFTER_TAX)
  assert.equal(r.lines[GIFI_NET_INCOME_AFTER_TAX].amount, NET_AFTER_TAX)

  // Balance sheet subtotals.
  assert.equal(r.totalAssets2599, ASSETS)
  assert.equal(r.totalLiabilities3499, LIABILITIES)
  assert.equal(r.totalEquity3620, EQUITY)

  // Retained earnings = continuity (5,000 + 50,000 − 0 = 55,000), NOT the 99,999
  // junk balance fed in for RE (which the engine ignores).
  assert.equal(r.retainedEarnings3600, RE_END)

  // GATE: 2599 = 3499 + 3620.
  assert.equal(r.totalAssets2599, r.totalLiabilities3499 + r.totalEquity3620)
  // GATE: 3640 = 2599.
  assert.equal(r.lines[GIFI_TOTAL_LIAB_AND_EQUITY].amount, r.totalAssets2599)

  // Balanced by construction → no plug, no error.
  assert.equal(r.roundingPlug, 0)
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0)
})

test('whole-dollar rounding plug keeps 2599 = 3499 + 3620 intact', () => {
  // Perturb the asset side by exactly $1 so the two independently-rounded sides
  // disagree by $1 — the residual must be absorbed into retained earnings (3600).
  const details = balancedDetails().map((d) =>
    d.code === '1001' ? { ...d, amount: ASSETS + 1 } : d,
  )
  const r = computeGifi({
    details,
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIVIDENDS,
    closingEntryPosted: false,
  })

  // The $1 residual is plugged into RE.
  assert.equal(r.roundingPlug, 1)
  assert.equal(r.retainedEarnings3600, RE_END + 1)
  assert.equal(r.totalEquity3620, EQUITY + 1)

  // The identity STILL holds exactly after the plug.
  assert.equal(r.totalAssets2599, r.totalLiabilities3499 + r.totalEquity3620)
  assert.equal(r.lines[GIFI_TOTAL_LIAB_AND_EQUITY].amount, r.totalAssets2599)

  // A $1 plug is rounding noise → WARNING, not an error.
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0)
  assert.ok(r.issues.some((i) => i.code === 'GIFI_ROUNDING_PLUG' && i.level === 'warning'))
})

test('3680 = 9999 holds PRE-CLOSE and the continuity reconciles', () => {
  const r = computeGifi({
    details: balancedDetails(),
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIVIDENDS,
    closingEntryPosted: false,
  })
  // RE-end = RE-start + 9999 − dividends, and the balance sheet balances with no
  // plug ⇒ the 3680/9999 continuity reconciles exactly.
  assert.equal(r.netIncome9999, NET_AFTER_TAX)
  assert.equal(r.retainedEarnings3600, RE_OPENING + r.netIncome9999 - DIVIDENDS)
  assert.equal(r.roundingPlug, 0)
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0)
})

test('including the closing entry WOULD break the gate (9999→0, RE continuity off)', () => {
  // Simulate what balancesAsOf would feed if kind=closing entries were NOT
  // excluded: the year-end closing entry zeroes income/expense accounts, so the
  // P&L detail collapses to 0 → net income 9999 = 0. Retained earnings on the
  // balance sheet, however, already carries the closed-in net income (RE rose to
  // 55,000 on the books). Feeding RE's POST-CLOSE book balance as a real equity
  // detail (instead of recomputing it pre-close) makes the equity side disagree
  // with the continuity identity by the whole net income → a hard error.
  const postClose: GifiDetailBalance[] = [
    { code: '1001', amount: ASSETS, accountIds: ['acc-cash'] },
    { code: '2620', amount: LIABILITIES, accountIds: ['acc-ap'] },
    { code: '3500', amount: SHARES, accountIds: ['acc-shares'] },
    // Income/expense accounts ZEROED by the closing entry:
    { code: '8000', amount: 0, accountIds: ['acc-sales'] },
    { code: '8521', amount: 0, accountIds: ['acc-adv'] },
    { code: '9990', amount: 0, accountIds: ['acc-tax'] },
  ]
  // With 9999 = 0 but the balance sheet still showing 105,000 of assets backed by
  // 40,000 liab + 65,000 equity, the continuity RE-end = 5,000 + 0 − 0 = 5,000
  // makes equity only 15,000 → assets (105,000) ≠ liab+equity (55,000): the plug
  // would be 50,000, far beyond $1 rounding → RE-continuity ERROR.
  const r = computeGifi({
    details: postClose,
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIVIDENDS,
    closingEntryPosted: true,
  })

  assert.equal(r.netIncome9999, 0) // closing entry zeroed the P&L
  assert.ok(Math.abs(r.roundingPlug) > 1)
  assert.ok(
    r.issues.some((i) => i.code === 'GIFI_RE_CONTINUITY' && i.level === 'error'),
    'post-close net income breaks the retained-earnings continuity gate',
  )
  // And the pre-close path (the engine's actual contract) does NOT have this error.
  const preClose = computeGifi({
    details: balancedDetails(),
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIVIDENDS,
    closingEntryPosted: false,
  })
  assert.equal(preClose.issues.filter((i) => i.level === 'error').length, 0)
})

test('dividends declared reduce retained earnings end (GIFI 3700 → 3600)', () => {
  const DIV = 20000
  // Re-balance the asset side for the new (lower) RE-end so the sheet still ties.
  const newReEnd = RE_OPENING + NET_AFTER_TAX - DIV // 35,000
  const newEquity = SHARES + newReEnd // 45,000
  const newAssets = LIABILITIES + newEquity // 85,000
  const details = balancedDetails().map((d) =>
    d.code === '1001' ? { ...d, amount: newAssets } : d,
  )
  const r = computeGifi({
    details,
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIV,
    closingEntryPosted: false,
  })
  assert.equal(r.dividendsDeclared3700, DIV)
  assert.equal(r.retainedEarnings3600, newReEnd)
  assert.equal(r.totalEquity3620, newEquity)
  assert.equal(r.totalAssets2599, r.totalLiabilities3499 + r.totalEquity3620)
  assert.equal(r.roundingPlug, 0)
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0)
})

test('closingEntryPosted flag surfaces the blocker-2 warning', () => {
  const r = computeGifi({
    details: balancedDetails(),
    retainedEarningsOpening: RE_OPENING,
    dividendsDeclared: DIVIDENDS,
    closingEntryPosted: true,
  })
  assert.ok(r.issues.some((i) => i.code === 'GIFI_CLOSING_POSTED' && i.level === 'warning'))
  // Pre-close build is still correct → no errors despite the warning.
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0)
})
