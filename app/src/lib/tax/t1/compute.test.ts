import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeT1 } from '@/lib/tax/t1/compute'
import type { DividendBreakdown } from '@/lib/tax/t1/types'
import { getRateTable } from '@/lib/tax/t1/rates'
import { round2 } from '@/lib/tax/round'

/**
 * GENERIC fixtures only — round figures ($120k, $150k), never the owner's real
 * numbers. These pin the load-bearing T1 v1 math: grossed-up net income, the
 * spouse amount in BOTH jurisdictions (fed 16,129 base vs AB 22,323 base), the
 * BPA value (including the REAL federal phase-out), the per-jurisdiction clamps
 * (no phantom refund), and the final balance owing.
 */

const RATES_2025 = getRateTable(2025, 'AB')

/** Build the dividend breakdown for an all-ELIGIBLE actual dividend (2025). */
function eligibleDividends(actual: number): DividendBreakdown {
  const taxableEligible = round2(actual * 1.38) // gross-up 38%
  const federalDtc = round2(taxableEligible * 0.150198) // fed eligible DTC
  return { taxableEligible, taxableNonEligible: 0, federalDtc }
}

test('married AB filer, $120,000 eligible dividends, $0-income spouse', () => {
  const dividends = eligibleDividends(120000)
  const r = computeT1(
    {}, // no manual lines: dividends flow through the breakdown
    RATES_2025,
    {
      maritalStatus: 'married',
      spouseNetIncome: 0,
      dateOfBirth: new Date(Date.UTC(1985, 0, 1)), // working-age → age amount $0
      dividends,
    },
  )

  // Grossed-up net income = $120,000 × 1.38 = $165,600 (no deductions).
  assert.equal(r.totalIncome, 165600.0)
  assert.equal(r.netIncome, 165600.0)
  assert.equal(r.taxableIncome, 165600.0)

  // Federal BPA: net income $165,600 < phase-out start ($177,882) → full $16,129.
  assert.equal(r.lines['30000'], 16129.0)
  // Federal spouse amount (line 30300) base = full phased BPA (16,129), spouse NI 0.
  assert.equal(r.lines['30300'], 16129.0)
  // Federal spouse CREDIT VALUE = 16,129 × 14.5%.
  assert.equal(r.federal.spouseAmountCredit, round2(16129 * 0.145))

  // Alberta BPA flat $22,323 (no phase-out); spouse base ALSO 22,323 (NOT 16,129).
  assert.equal(r.lines['58040'], 22323.0)
  assert.equal(r.lines['58120'], 22323.0)
  assert.equal(r.provincial.spouseAmountCredit, round2(22323 * 0.08))

  // AB dividend tax credit is RECOMPUTED at 8.12% of the grossed-up eligible
  // amount (never copied from the slip's federal box).
  assert.equal(r.provincial.dividendTaxCredit, round2(165600 * 0.0812))

  // Federal clamp 42000 = max(0, grossFed − NRTC×14.5% − DTC40425 − donations).
  assert.equal(r.federal.netTax, 3752.05)
  // Alberta clamp 42800 = max(0, …) — credits exceed gross AB tax → $0 (clamped,
  // never negative; no phantom refund).
  assert.equal(r.provincial.netTax, 0)

  // 43500 = 42000 + 42800.
  assert.equal(r.totalPayable, 3752.05)
  // No withholding / instalments → balance owing = total payable, no refund.
  assert.equal(r.balanceOwing, 3752.05)
  assert.equal(r.refund, 0)
})

test('AB clamp never produces a phantom refund even when credits exceed AB tax', () => {
  // Smaller dividend keeps AB tax low while AB BPA + spouse + DTC still exceed it.
  const dividends = eligibleDividends(50000)
  const r = computeT1({}, RATES_2025, {
    maritalStatus: 'married',
    spouseNetIncome: 0,
    dateOfBirth: null,
    dividends,
  })
  assert.equal(r.provincial.netTax, 0)
  assert.ok(r.federal.netTax >= 0)
  assert.equal(r.refund, 0)
})

test('spouse net income reduces the spouse amount in BOTH jurisdictions', () => {
  const dividends = eligibleDividends(120000)
  const spouseNI = 5000
  const r = computeT1({}, RATES_2025, {
    maritalStatus: 'married',
    spouseNetIncome: spouseNI,
    dateOfBirth: null,
    dividends,
  })
  // Federal: max(0, 16,129 − 5,000) = 11,129.
  assert.equal(r.lines['30300'], 11129.0)
  // Alberta: max(0, 22,323 − 5,000) = 17,323 (different base).
  assert.equal(r.lines['58120'], 17323.0)
})

test('single filer claims no spouse amount in either jurisdiction', () => {
  const dividends = eligibleDividends(120000)
  const r = computeT1({}, RATES_2025, {
    maritalStatus: 'single',
    spouseNetIncome: null,
    dateOfBirth: null,
    dividends,
  })
  assert.equal(r.lines['30300'], 0)
  assert.equal(r.lines['58120'], 0)
  assert.equal(r.federal.spouseAmountCredit, 0)
  assert.equal(r.provincial.spouseAmountCredit, 0)
})

test('federal BPA phase-out is REAL: $150k eligible (net $207,000) phases the BPA down', () => {
  // $150,000 × 1.38 = $207,000 net income — inside the 177,882 → 253,414 band.
  const dividends = eligibleDividends(150000)
  const r = computeT1({}, RATES_2025, {
    maritalStatus: 'married',
    spouseNetIncome: 0,
    dateOfBirth: null,
    dividends,
  })
  assert.equal(r.netIncome, 207000.0)

  // Hand calc: reduction = (16,129 − 14,538) × (207,000 − 177,882)/(253,414 − 177,882)
  //                      = 1,591 × 29,118/75,532 ≈ 613.34 → BPA ≈ 15,515.66.
  const span = 253414 - 177882
  const handBpa = 16129 - 1591 * ((207000 - 177882) / span)
  assert.ok(
    Math.abs(r.lines['30000'] - handBpa) < 1,
    `phased BPA ${r.lines['30000']} within $1 of hand calc ${handBpa}`,
  )
  // The phased-down BPA must be strictly between min and max.
  assert.ok(r.lines['30000'] > 14538 && r.lines['30000'] < 16129)

  // Federal spouse amount (line 30300) uses the SAME live phased BPA as its base.
  assert.ok(Math.abs(r.lines['30300'] - handBpa) < 1)
  // Alberta spouse base stays the flat full AB BPA (NO phase-out).
  assert.equal(r.lines['58120'], 22323.0)
})

test('Top-Up (34990) and AB supplemental are $0 gated hooks for the base filer', () => {
  const dividends = eligibleDividends(120000)
  const r = computeT1({}, RATES_2025, {
    maritalStatus: 'married',
    spouseNetIncome: 0,
    dateOfBirth: null,
    dividends,
  })
  assert.equal(r.federal.supplementalCredit, 0)
  assert.equal(r.provincial.supplementalCredit, 0)
  assert.equal(r.lines['34990'], 0)
})

test('withholding + instalments reduce the balance owing (47600 default $0)', () => {
  const dividends = eligibleDividends(120000)
  const r = computeT1(
    { '43700': 1000, '47600': 500 },
    RATES_2025,
    { maritalStatus: 'married', spouseNetIncome: 0, dateOfBirth: null, dividends },
  )
  // total payable $3,752.05 − $1,500 = $2,252.05 owing.
  assert.equal(r.totalPayable, 3752.05)
  assert.equal(r.balanceOwing, 2252.05)
  assert.equal(r.refund, 0)
})

test('non-eligible AB dividend tax credit recomputed at 2.18% (not copied)', () => {
  // Pure non-eligible path: AB DTC must use 2.18%, never the slip box.
  const taxableNonEligible = round2(80000 * 1.15) // 92,000
  const federalDtc = round2(taxableNonEligible * 0.090301)
  const dividends: DividendBreakdown = {
    taxableEligible: 0,
    taxableNonEligible,
    federalDtc,
  }
  const r = computeT1({}, RATES_2025, {
    maritalStatus: 'married',
    spouseNetIncome: 0,
    dateOfBirth: null,
    dividends,
  })
  assert.equal(r.lines['12010'], 92000.0)
  assert.equal(r.provincial.dividendTaxCredit, round2(92000 * 0.0218))
  // Federal consumes the slip DTC (40425) directly.
  assert.equal(r.federal.dividendTaxCredit, federalDtc)
})
