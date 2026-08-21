/**
 * PURE federal T2 (CCPC) compute engine — `computeT2Federal`.
 *
 * Same purity contract as `computeT5Boxes` / `computeT1`: a deterministic
 * function over its inputs with NO I/O. Given the assembled `T2FederalInput`
 * (taxable income, the active/investment split, the dividend pull, the continuity
 * openings) and a resolved federal rate profile, it produces the full
 * `T2FederalResult` — Part I, SBD + grind, ART, Part IV, ERDTOH/NERDTOH, the
 * pool-split dividend refund, the GRIP gate, and the line snapshot it touched.
 *
 * SCOPE v1 (the real filer): an owner-managed CCPC, Alberta-resident, Dec-31 FYE,
 * full 12-month years only, ACTIVE business income only (AII ≈ 0), single
 * shareholder paid via the corporation's own dividends. For that persona AII = 0,
 * so ART / NERDTOH / Part IV / dividend refund all degrade cleanly to 0 — the
 * engine handles a non-zero AII edge so those paths are exercised and correct.
 *
 * The math is the EXACT corrected calc from the gap review (every tax-math
 * correction folded in):
 *
 *   fullRateTI = TI − sbdIncome − AII                               (ITA 123.4(1))
 *   Part I     = 0.38×TI − 0.10×TI(abatement, 100% in AB)
 *                       − 0.13×fullRateTI                            (GRR; NOT on AII)
 *                       − 0.19×sbdIncome
 *                       + 0.1067×min(AII, TI)                        (ART, ITA 123.3)
 *                       + 0.05×psbTaxableIncome                      (PSB, ITA 123.5)
 *
 *   SBD grind  = MAX(taxableCapitalGrind, priorYearAaiiGrind)       (ITA 125(5.1))
 *                — the GREATER, NOT the sum.
 *   businessLimit = max(0, 500000 − grind)
 *   sbdIncome     = min(ABI, businessLimit, TI)   (PSB ⇒ no SBD)
 *
 *   ERDTOH addition  = 0.3833 × eligible Part IV
 *   NERDTOH addition = 0.3067 × AII + 0.3833 × non-eligible Part IV
 *   Part IV          = 0.3833 × portfolio taxable dividends received
 *
 *   Dividend refund is POOL-SPECIFIC with 129(1) ordering:
 *     eligibleRefund    = min(0.3833 × eligDivsPaid, ERDTOH)
 *     nonEligibleRefund = min(0.3833 × nonEligDivsPaid, NERDTOH) (+ ERDTOH spillover)
 *
 *   closingGripBeforeDivs = openingGRIP + 0.72 × fullRateTI + eligDivsReceived
 *   gate: eligDivsPaid ≤ closingGripBeforeDivs   (excess → ITA 185.1 Part III.1)
 *   closingGRIP           = closingGripBeforeDivs − eligDivsPaid
 *
 * Pure data only — NO I/O in this file (mirrors compute/t5.ts, t1/compute.ts).
 */

import { round2 } from '@/lib/tax/round'
import type { FederalT2Rates } from '@/lib/tax/t2/rates/federal2025'
import type { T2FederalInput, T2FederalResult, T2Lines } from '@/lib/tax/t2/types'

// ---------------------------------------------------------------------------
// "form:line" keys the federal engine writes (page-3 carries + schedule lines).
// ---------------------------------------------------------------------------

const LINE = {
  // Schedule 1 / page 3
  TAXABLE_INCOME: 'S1:300', // net income for tax (Sch 1 line 300 → T2 page 3)
  // SBD / Schedule 7
  ABI: 'S7:400', // active business income carried to the SBD calc
  BUSINESS_LIMIT: 'S7:410', // reduced business limit
  SBD_GRIND: 'S7:415', // the business-limit reduction (greater of the two grinds)
  SBD_INCOME: 'S7:425', // small-business income actually used
  SBD_DEDUCTION: 'T2:430', // small business deduction (19% of sbdIncome)
  // Part I / tax
  FULL_RATE_TI: 'T2:550', // full-rate taxable income (TI − sbd − AII)
  GRR: 'T2:638', // general rate reduction amount (informational)
  PART_ONE_TAX: 'T2:700', // Part I tax payable (incl. ART + PSB)
  ART: 'T2:604', // additional refundable tax on AII
  PSB_TAX: 'T2:560', // PSB additional tax (ITA 123.5)
  // Part IV / RDTOH
  PART_FOUR: 'T2:712', // Part IV tax
  ERDTOH_CLOSE: 'T2:530', // eligible RDTOH, closing
  NERDTOH_CLOSE: 'T2:545', // non-eligible RDTOH, closing
  // Dividend refund
  DIVIDEND_REFUND: 'T2:784', // total dividend refund
  ELIGIBLE_REFUND: 'T2:784E', // eligible-pool refund (synthetic detail)
  NONELIGIBLE_REFUND: 'T2:784N', // non-eligible-pool refund (synthetic detail)
  // GRIP (Schedule 53)
  GRIP_CLOSE: 'T2:770', // closing GRIP (→ next year's opening)
} as const

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

/** Clamp a number to ≥ 0 and round to 2 dp. */
function pos2(x: number): number {
  return round2(Math.max(0, x))
}

/**
 * The AAII passive-income grind (ITA 125(5.1)(b)): $5 of business limit lost per
 * $1 of PRIOR-year AAII over $50,000, reaching the full $500,000 (nil limit) at
 * $150,000. Returns the limit REDUCTION, clamped to [0, businessLimit].
 */
function aaiiGrind(priorYearAaii: number, rates: FederalT2Rates): number {
  if (priorYearAaii <= rates.aaiiGrindThreshold) return 0
  const over = priorYearAaii - rates.aaiiGrindThreshold
  const reduction = over * rates.aaiiGrindPerDollar
  return Math.min(reduction, rates.businessLimit)
}

/**
 * The taxable-capital grind (ITA 125(5.1)(a)): the $500,000 limit is ground down
 * linearly across taxable capital employed in Canada from $10M to $50M, nil at
 * $50M. Returns the limit REDUCTION, clamped to [0, businessLimit].
 */
function taxableCapitalGrind(taxableCapital: number, rates: FederalT2Rates): number {
  if (taxableCapital <= rates.taxableCapitalGrindStart) return 0
  const band = rates.taxableCapitalGrindEnd - rates.taxableCapitalGrindStart
  if (band <= 0) return rates.businessLimit
  const fraction = (taxableCapital - rates.taxableCapitalGrindStart) / band
  const reduction = rates.businessLimit * fraction
  return Math.min(Math.max(0, reduction), rates.businessLimit)
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Compute the full federal CCPC result from the assembled input + rate profile.
 * Pure: no DB, no clock, no randomness. Re-runnable for drift detection.
 *
 * `engineVersion` is threaded in by the caller (buildT2/pull resolve it from the
 * rate registry so the federal + Alberta + AccII hashes line up in one string).
 */
export function computeT2Federal(
  input: T2FederalInput,
  rates: FederalT2Rates,
  engineVersion: string,
): T2FederalResult {
  const isPsb = input.isPersonalServicesBusiness

  // Inputs clamped to sane non-negative magnitudes (a negative TI means no tax;
  // SBD/AII bases cannot be negative).
  const taxableIncome = round2(Math.max(0, input.taxableIncome))
  const abi = round2(Math.max(0, input.activeBusinessIncome))
  const aii = round2(Math.max(0, input.aggregateInvestmentIncome))

  // ---- Schedule 7: business limit grind (GREATER of the two grinds) ----
  const capGrind = round2(taxableCapitalGrind(input.taxableCapital, rates))
  const passiveGrind = round2(aaiiGrind(input.priorYearAaii, rates))
  const sbdGrind = round2(Math.max(capGrind, passiveGrind))
  const businessLimit = pos2(rates.businessLimit - sbdGrind)

  // ---- SBD income (no SBD for a PSB) ----
  const sbdIncome = isPsb ? 0 : round2(Math.min(abi, businessLimit, taxableIncome))
  const sbdDeduction = round2(sbdIncome * rates.sbdRate)

  // ---- full-rate taxable income = TI − sbdIncome − AII (NOT eligible for GRR otherwise) ----
  // A PSB earns no SBD and no GRR; its income is full-rate but the GRR is denied,
  // so it is excluded from the GRR base.
  const fullRateTaxableIncome = pos2(taxableIncome - sbdIncome - aii)
  const grrBase = isPsb ? 0 : fullRateTaxableIncome

  // ---- ART (additional refundable tax on AII) ----
  const art = round2(rates.artRate * Math.min(aii, taxableIncome))

  // ---- PSB additional tax (ITA 123.5) ----
  const psbAdditionalTax = isPsb ? round2(rates.psbAdditionalRate * taxableIncome) : 0

  // ---- Part I tax ----
  const basic = taxableIncome * rates.basicRate
  const abatement = taxableIncome * rates.abatementRate // 100% provincial in AB
  const grr = grrBase * rates.generalRateReduction
  const sbdReduction = sbdIncome * rates.sbdRate
  const partOneTax = pos2(basic - abatement - grr - sbdReduction + art + psbAdditionalTax)

  // ---- Part IV tax on portfolio dividends received ----
  const eligiblePortfolio = round2(Math.max(0, input.eligiblePortfolioDividends))
  const nonEligiblePortfolio = round2(Math.max(0, input.nonEligiblePortfolioDividends))
  const eligiblePartFour = round2(rates.partFourRate * eligiblePortfolio)
  const nonEligiblePartFour = round2(rates.partFourRate * nonEligiblePortfolio)
  const partFourTax = round2(eligiblePartFour + nonEligiblePartFour)

  // ---- RDTOH pools (post-2018 split) ----
  // ERDTOH addition = 38⅓% × eligible Part IV.
  // NERDTOH addition = 30⅔% × AII + 38⅓% × non-eligible Part IV.
  const openingErdtoh = round2(Math.max(0, input.openingErdtoh))
  const openingNerdtoh = round2(Math.max(0, input.openingNerdtoh))
  const erdtohAddition = round2(eligiblePartFour)
  const nerdtohAddition = round2(rates.nerdtohOnAiiRate * aii + nonEligiblePartFour)
  // Pre-refund pool balances.
  const erdtohBeforeRefund = round2(openingErdtoh + erdtohAddition)
  const nerdtohBeforeRefund = round2(openingNerdtoh + nerdtohAddition)

  // ---- Dividend refund — POOL-SPECIFIC with ITA 129(1) ordering ----
  const eligibleDivsPaid = round2(Math.max(0, input.eligibleDividendsPaid))
  const nonEligibleDivsPaid = round2(Math.max(0, input.nonEligibleDividendsPaid))

  // Non-eligible dividends recover NERDTOH first, then spill into ERDTOH (129(1)).
  const nonEligRefundCapacity = round2(rates.dividendRefundRate * nonEligibleDivsPaid)
  const fromNerdtoh = round2(Math.min(nonEligRefundCapacity, nerdtohBeforeRefund))
  const nonEligSpillToErdtoh = round2(
    Math.min(nonEligRefundCapacity - fromNerdtoh, erdtohBeforeRefund),
  )
  const nonEligibleRefund = round2(fromNerdtoh + nonEligSpillToErdtoh)

  // Eligible dividends recover ERDTOH only — against what the non-eligible spill
  // did not already consume.
  const erdtohRemaining = round2(Math.max(0, erdtohBeforeRefund - nonEligSpillToErdtoh))
  const eligRefundCapacity = round2(rates.dividendRefundRate * eligibleDivsPaid)
  const eligibleRefund = round2(Math.min(eligRefundCapacity, erdtohRemaining))

  const dividendRefund = round2(eligibleRefund + nonEligibleRefund)

  // ---- Closing RDTOH pools (carry to next year's opening) ----
  const closingErdtoh = pos2(erdtohBeforeRefund - nonEligSpillToErdtoh - eligibleRefund)
  const closingNerdtoh = pos2(nerdtohBeforeRefund - fromNerdtoh)

  // ---- GRIP (Schedule 53) — gate against CLOSING GRIP ----
  const openingGrip = round2(Math.max(0, input.openingGrip))
  const eligibleDivsReceived = round2(Math.max(0, input.eligibleDividendsReceived))
  const closingGripBeforeDivs = round2(
    openingGrip + rates.gripFactor * fullRateTaxableIncome + eligibleDivsReceived,
  )
  const gripOverDesignated = eligibleDivsPaid > round2(closingGripBeforeDivs + 0.005)
  const closingGrip = round2(closingGripBeforeDivs - eligibleDivsPaid)

  // ---- assemble the line snapshot the engine touched ----
  const lines: T2Lines = {
    [LINE.TAXABLE_INCOME]: taxableIncome,
    [LINE.ABI]: abi,
    [LINE.BUSINESS_LIMIT]: businessLimit,
    [LINE.SBD_GRIND]: sbdGrind,
    [LINE.SBD_INCOME]: sbdIncome,
    [LINE.SBD_DEDUCTION]: sbdDeduction,
    [LINE.FULL_RATE_TI]: fullRateTaxableIncome,
    [LINE.GRR]: round2(grr),
    [LINE.PART_ONE_TAX]: partOneTax,
    [LINE.ART]: art,
    [LINE.PSB_TAX]: psbAdditionalTax,
    [LINE.PART_FOUR]: partFourTax,
    [LINE.ERDTOH_CLOSE]: closingErdtoh,
    [LINE.NERDTOH_CLOSE]: closingNerdtoh,
    [LINE.DIVIDEND_REFUND]: dividendRefund,
    [LINE.ELIGIBLE_REFUND]: eligibleRefund,
    [LINE.NONELIGIBLE_REFUND]: nonEligibleRefund,
    [LINE.GRIP_CLOSE]: closingGrip,
  }

  return {
    taxationYear: input.taxationYear,
    taxableIncome,
    fullRateTaxableIncome,
    sbdIncome,
    businessLimit,
    sbdGrind,
    partOneTax,
    art,
    psbAdditionalTax,
    partFourTax,
    eligiblePartFour,
    nonEligiblePartFour,
    closingErdtoh,
    closingNerdtoh,
    dividendRefund,
    eligibleRefund,
    nonEligibleRefund,
    closingGripBeforeDivs,
    closingGrip,
    gripOverDesignated,
    lines,
    engineVersion,
  }
}
