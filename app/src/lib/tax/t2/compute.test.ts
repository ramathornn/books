import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeT2Federal } from '@/lib/tax/t2/computeT2Federal'
import { computeAt1 } from '@/lib/tax/t2/computeAt1'
import { getRateTable, engineVersionFor } from '@/lib/tax/t2/rates/index'
import { round2 } from '@/lib/tax/round'
import type { T2FederalInput, At1Input } from '@/lib/tax/t2/types'

/**
 * GENERIC fixtures only — round figures ($300k, $100k), never a real corporate
 * value. These pin the load-bearing T2 v1 math: the corrected Part I
 * (fullRateTI = TI − sbd − AII), the MAX() SBD grind, ART/NERDTOH firing on AII,
 * the POOL-SPECIFIC dividend refund with 129(1) ordering, the CLOSING-GRIP gate,
 * and the Alberta 8%/2% split.
 */

const RATES = getRateTable(2025, 'AB')
const FED = RATES.federal
const AB = RATES.alberta
const EV = engineVersionFor(2025)

/** A zeroed federal input the tests override field-by-field. */
function fedInput(overrides: Partial<T2FederalInput>): T2FederalInput {
  return {
    taxationYear: 2025,
    taxableIncome: 0,
    activeBusinessIncome: 0,
    aggregateInvestmentIncome: 0,
    priorYearAaii: 0,
    taxableCapital: 0,
    portfolioDividendsReceived: 0,
    eligiblePortfolioDividends: 0,
    nonEligiblePortfolioDividends: 0,
    eligibleDividendsPaid: 0,
    nonEligibleDividendsPaid: 0,
    openingErdtoh: 0,
    openingNerdtoh: 0,
    openingGrip: 0,
    eligibleDividendsReceived: 0,
    isPersonalServicesBusiness: false,
    ...overrides,
  }
}

function at1Input(overrides: Partial<At1Input>): At1Input {
  return {
    taxationYear: 2025,
    albertaTaxableIncome: 0,
    activeBusinessIncome: 0,
    reducedBusinessLimit: 500000,
    allocationFactor: 1.0,
    innovationEmploymentGrant: 0,
    isPersonalServicesBusiness: false,
    ...overrides,
  }
}

// ===========================================================================
// (a) THE CANONICAL PERSONA — active-income CCPC, $0 AII, $0 GRIP, all
//     dividends non-eligible. $300,000 ABI fully under the $500k limit.
// ===========================================================================

test('canonical persona: $300k active-income CCPC — SBD at 9%, AII machinery degrades to 0', () => {
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 300000,
      activeBusinessIncome: 300000,
      // all dividends paid non-eligible; no RDTOH pools, no portfolio dividends.
      nonEligibleDividendsPaid: 100000,
    }),
    FED,
    EV,
  )

  // Full $500k limit (no grind), all $300k ABI is SBD income.
  assert.equal(r.sbdGrind, 0)
  assert.equal(r.businessLimit, 500000)
  assert.equal(r.sbdIncome, 300000)

  // fullRateTI = TI − sbd − AII = 300,000 − 300,000 − 0 = 0.
  assert.equal(r.fullRateTaxableIncome, 0)

  // Part I = 0.38×300k − 0.10×300k − 0.13×0 − 0.19×300k + 0 (ART) + 0 (PSB)
  //        = 300,000 × (0.38 − 0.10 − 0.19) = 300,000 × 0.09 = $27,000  (the 9% net SBD rate).
  assert.equal(r.partOneTax, 27000)

  // AII machinery all degrades to 0.
  assert.equal(r.art, 0)
  assert.equal(r.partFourTax, 0)
  assert.equal(r.closingErdtoh, 0)
  assert.equal(r.closingNerdtoh, 0)
  assert.equal(r.dividendRefund, 0)
  assert.equal(r.eligibleRefund, 0)
  assert.equal(r.nonEligibleRefund, 0)
  assert.equal(r.psbAdditionalTax, 0)

  // $0 opening GRIP, no eligible dividends paid → no over-designation, closing GRIP 0.
  assert.equal(r.closingGripBeforeDivs, 0)
  assert.equal(r.closingGrip, 0)
  assert.equal(r.gripOverDesignated, false)
})

test('canonical persona: Alberta AT1 at 2% on the same $300k SBD income', () => {
  const r = computeAt1(
    at1Input({
      albertaTaxableIncome: 300000,
      activeBusinessIncome: 300000,
      reducedBusinessLimit: 500000, // federal reduced limit (no grind), inherited
      allocationFactor: 1.0,
    }),
    AB,
    EV,
  )

  // All $300k is small-business income (under the $500k allocated limit).
  assert.equal(r.albertaSbdIncome, 300000)
  assert.equal(r.generalRateIncome, 0)
  // SBD amount = 6-point spread on $300k = $18,000 (takes 8% down to 2%).
  assert.equal(r.albertaSbdAmount, 18000)
  // Tax before credits = 0.02 × 300,000 = $6,000.
  assert.equal(r.taxBeforeCredits, 6000)
  assert.equal(r.innovationEmploymentGrant, 0)
  assert.equal(r.albertaTaxPayable, 6000)
})

test('canonical persona: ABI above the limit → SBD capped, excess at the 15% general rate', () => {
  // $700k ABI: $500k SBD income, $200k full-rate.
  const r = computeT2Federal(
    fedInput({ taxableIncome: 700000, activeBusinessIncome: 700000 }),
    FED,
    EV,
  )
  assert.equal(r.sbdIncome, 500000)
  assert.equal(r.fullRateTaxableIncome, 200000)
  // Part I = 0.38×700k − 0.10×700k − 0.13×200k − 0.19×500k
  //        = 266,000 − 70,000 − 26,000 − 95,000 = $75,000.
  // Cross-check: $500k @ 9% ($45k) + $200k @ 15% ($30k) = $75,000.
  assert.equal(r.partOneTax, 75000)
})

// ===========================================================================
// (b) AII > 0 EDGE — proves ART / NERDTOH / pool-refund fire correctly.
// ===========================================================================

test('AII edge: ART and NERDTOH fire on aggregate investment income', () => {
  // $100k AII, no ABI, no portfolio dividends received.
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 100000,
      activeBusinessIncome: 0,
      aggregateInvestmentIncome: 100000,
    }),
    FED,
    EV,
  )

  // ART = 0.1067 × min(100k, 100k) = $10,670.
  assert.equal(r.art, round2(0.1067 * 100000))
  assert.equal(r.art, 10670)

  // fullRateTI = 100k − 0 (sbd) − 100k (AII) = 0 → no GRR.
  assert.equal(r.fullRateTaxableIncome, 0)

  // Part I = 0.38×100k − 0.10×100k − 0.13×0 − 0.19×0 + 10,670 (ART)
  //        = 38,000 − 10,000 + 10,670 = $38,670.
  assert.equal(r.partOneTax, 38670)

  // NERDTOH addition = 0.3067 × 100k + 0 = $30,670 → closing NERDTOH (nothing paid).
  assert.equal(r.closingNerdtoh, round2(0.3067 * 100000))
  assert.equal(r.closingNerdtoh, 30670)
  // No Part IV (no portfolio dividends), so no ERDTOH.
  assert.equal(r.partFourTax, 0)
  assert.equal(r.closingErdtoh, 0)
})

test('AII edge: Part IV on portfolio dividends builds ERDTOH/NERDTOH by pool', () => {
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 50000,
      aggregateInvestmentIncome: 50000,
      portfolioDividendsReceived: 20000,
      eligiblePortfolioDividends: 12000,
      nonEligiblePortfolioDividends: 8000,
    }),
    FED,
    EV,
  )
  // Part IV = 0.3833 × 20,000 = $7,666; split by pool.
  assert.equal(r.partFourTax, round2(0.3833 * 20000))
  assert.equal(r.eligiblePartFour, round2(0.3833 * 12000))
  assert.equal(r.nonEligiblePartFour, round2(0.3833 * 8000))
  // ERDTOH = eligible Part IV; NERDTOH = 0.3067×AII + non-eligible Part IV.
  assert.equal(r.closingErdtoh, round2(0.3833 * 12000))
  assert.equal(r.closingNerdtoh, round2(0.3067 * 50000 + 0.3833 * 8000))
})

test('AII edge: pool-specific dividend refund with 129(1) ordering', () => {
  // Build NERDTOH and ERDTOH pools, then pay a non-eligible dividend that
  // recovers NERDTOH first and an eligible dividend that touches ERDTOH only.
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 100000,
      aggregateInvestmentIncome: 100000, // NERDTOH addition 0.3067×100k = 30,670
      openingErdtoh: 5000,
      eligibleDividendsPaid: 6000,
      nonEligibleDividendsPaid: 30000,
    }),
    FED,
    EV,
  )

  // Non-eligible refund = min(0.3833 × 30,000, NERDTOH 30,670) = min(11,499, 30,670) = 11,499.
  const nonEligCap = round2(0.3833 * 30000)
  assert.equal(r.nonEligibleRefund, nonEligCap) // 11,499; fully from NERDTOH, no spill
  // Eligible refund = min(0.3833 × 6,000, ERDTOH 5,000) = min(2,299.8, 5,000) = 2,299.8.
  assert.equal(r.eligibleRefund, round2(0.3833 * 6000))
  assert.equal(r.dividendRefund, round2(nonEligCap + 0.3833 * 6000))

  // Closing pools: NERDTOH 30,670 − 11,499 = 19,171; ERDTOH 5,000 − 2,299.8 = 2,700.2.
  assert.equal(r.closingNerdtoh, round2(30670 - nonEligCap))
  assert.equal(r.closingErdtoh, round2(5000 - 0.3833 * 6000))
})

test('AII edge: non-eligible refund spills into ERDTOH when NERDTOH is exhausted (129(1))', () => {
  // Small NERDTOH, large ERDTOH, big non-eligible dividend → spillover path.
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 0,
      openingNerdtoh: 1000,
      openingErdtoh: 10000,
      nonEligibleDividendsPaid: 30000, // capacity 0.3833×30k = 11,499
    }),
    FED,
    EV,
  )
  // From NERDTOH = min(11,499, 1,000) = 1,000; spill into ERDTOH = min(10,499, 10,000) = 10,000.
  assert.equal(r.nonEligibleRefund, round2(1000 + 10000))
  assert.equal(r.closingNerdtoh, 0)
  assert.equal(r.closingErdtoh, 0)
})

// ===========================================================================
// (c) GRIP EDGE — an eligible dividend over closing GRIP is flagged.
// ===========================================================================

test('GRIP edge: eligible dividend within closing GRIP room is NOT flagged', () => {
  // $200k full-rate income → GRIP addition 0.72×200k = $144,000; pay $100k eligible.
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 700000,
      activeBusinessIncome: 700000, // sbd 500k → fullRateTI 200k
      openingGrip: 0,
      eligibleDividendsPaid: 100000,
    }),
    FED,
    EV,
  )
  assert.equal(r.fullRateTaxableIncome, 200000)
  // closingGripBeforeDivs = 0 + 0.72 × 200,000 + 0 = $144,000.
  assert.equal(r.closingGripBeforeDivs, 144000)
  // $100k ≤ $144k room → not over-designated; closing GRIP = 144k − 100k = $44k.
  assert.equal(r.gripOverDesignated, false)
  assert.equal(r.closingGrip, 44000)
})

test('GRIP edge: eligible dividend OVER closing GRIP is flagged (ITA 185.1 risk)', () => {
  // Active-only persona (fullRateTI 0, $0 opening GRIP) paying an eligible
  // dividend → no GRIP room at all → flagged.
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 300000,
      activeBusinessIncome: 300000, // sbd 300k → fullRateTI 0 → no GRIP added
      openingGrip: 0,
      eligibleDividendsPaid: 50000,
    }),
    FED,
    EV,
  )
  assert.equal(r.closingGripBeforeDivs, 0)
  assert.equal(r.gripOverDesignated, true)
  // closing GRIP goes negative (the over-designated amount).
  assert.equal(r.closingGrip, -50000)
})

test('GRIP edge: opening GRIP + eligible dividends received enlarge the room', () => {
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 0,
      openingGrip: 30000,
      eligibleDividendsReceived: 20000,
      eligibleDividendsPaid: 40000,
    }),
    FED,
    EV,
  )
  // room = 30,000 + 0 + 20,000 = $50,000 ≥ $40,000 paid → not flagged.
  assert.equal(r.closingGripBeforeDivs, 50000)
  assert.equal(r.gripOverDesignated, false)
  assert.equal(r.closingGrip, 10000)
})

// ===========================================================================
// PSB + grind edges (prove the corrected MAX() grind and +5% PSB surtax).
// ===========================================================================

test('SBD grind is the GREATER of the two grinds, not the sum', () => {
  // Prior-year AAII $100k → passive grind = (100k − 50k) × 5 = $250,000.
  // Taxable capital $30M → cap grind = 500k × (30M−10M)/(50M−10M) = $250,000.
  // MAX = $250,000 (NOT $500,000 if summed). businessLimit = $250,000.
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 400000,
      activeBusinessIncome: 400000,
      priorYearAaii: 100000,
      taxableCapital: 30000000,
    }),
    FED,
    EV,
  )
  assert.equal(r.sbdGrind, 250000)
  assert.equal(r.businessLimit, 250000)
  // sbdIncome = min(ABI 400k, limit 250k, TI 400k) = $250,000.
  assert.equal(r.sbdIncome, 250000)
})

test('PSB: no SBD, no GRR, +5% additional tax', () => {
  const r = computeT2Federal(
    fedInput({
      taxableIncome: 200000,
      activeBusinessIncome: 200000,
      isPersonalServicesBusiness: true,
    }),
    FED,
    EV,
  )
  assert.equal(r.sbdIncome, 0)
  assert.equal(r.psbAdditionalTax, round2(0.05 * 200000)) // $10,000
  // Part I = 0.38×200k − 0.10×200k − 0 (no GRR) − 0 (no SBD) + 0 (ART) + 10,000 (PSB)
  //        = 76,000 − 20,000 + 10,000 = $66,000.
  assert.equal(r.partOneTax, 66000)
})

test('Alberta: PSB earns no AB SBD (all at 8%)', () => {
  const r = computeAt1(
    at1Input({
      albertaTaxableIncome: 200000,
      activeBusinessIncome: 200000,
      isPersonalServicesBusiness: true,
    }),
    AB,
    EV,
  )
  assert.equal(r.albertaSbdIncome, 0)
  assert.equal(r.generalRateIncome, 200000)
  assert.equal(r.taxBeforeCredits, round2(0.08 * 200000)) // $16,000
})

test('Alberta: IEG reduces tax payable, clamped at 0', () => {
  const r = computeAt1(
    at1Input({
      albertaTaxableIncome: 300000,
      activeBusinessIncome: 300000,
      innovationEmploymentGrant: 10000,
    }),
    AB,
    EV,
  )
  // tax before credits $6,000 − IEG $10,000 → clamped to $0 (never negative).
  assert.equal(r.taxBeforeCredits, 6000)
  assert.equal(r.albertaTaxPayable, 0)
})
