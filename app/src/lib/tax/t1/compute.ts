/**
 * PURE T1 compute engine — `computeT1`.
 *
 * Same purity contract as `computeT5Boxes`: a deterministic function over its
 * inputs with NO I/O. Given the effective T1 lines (already pulled/overridden),
 * a resolved rate table, and the small identity/dividend context, it produces a
 * fully-derived `T1Result` (every CRA line it touched + the federal/AB
 * jurisdiction breakdowns + the refund/owing summary).
 *
 * SCOPE v1 (the real filer): MARRIED, full-year ALBERTA resident CCPC owner paid
 * PERSONALLY via the company's own T5 dividends (eligible and/or non-eligible),
 * NO foreign income, NO T4 salary. CPP/EI/Schedule 8 are suppressed entirely.
 *
 * The ordering (gap-review items 6 & 7) is load-bearing:
 *   1. total income (15000) = sum of income lines
 *   2. net income (23600, grossed-up) = total income − deductions  ← drives ALL
 *      income-tested credit AMOUNTS
 *   3. income-tested credit AMOUNTS off net income:
 *        - federal BPA phase-out (177,882 → 253,414; REAL, not a no-op)
 *        - spouse amount in BOTH jurisdictions with DIFFERENT bases
 *          (fed 30300 = max(0, fedBPA_after_phaseout − spouseNI) × 14.5%;
 *           AB  58120 = max(0, 22,323               − spouseNI) × 8%)
 *        - age amount (income-tested; $0 for a working-age owner)
 *        - medical floor (opt-in; $0 here)
 *   4. taxable income (26000) = net income − Division-C deductions (none here)
 *   5. gross federal + gross AB tax on the SAME taxable income (brackets)
 *   6. federal credits: NRTCs×14.5% + donation tiers + DTC (40425) + Top-Up hook
 *      → clamp 42000 = max(0, grossFed − …)  (no excess credit → refund)
 *   7. AB credits: NRTCs×8% + AB donation tiers + AB_DTC RECOMPUTED at
 *      8.12%/2.18% (never copied from the slip box) + AB supplemental hook
 *      → clamp 42800 = max(0, grossAB − …)
 *   8. 43500 = 42000 + 42800
 *   9. − 43700 withholding − 47600 instalments → refund 48400 / owing 48500
 *
 * Federal Top-Up (34990) and the AB supplemental credit are modeled as GATED
 * hooks that return $0 for this filer (below thresholds); they must not perturb
 * the base case.
 *
 * Pure data only — NO I/O in this file (mirrors compute/t5.ts).
 */

import { round2 } from '@/lib/tax/round'
import { COUPLED_STATUSES, makeEngineVersion } from '@/lib/tax/t1/types'
import type {
  Bracket,
  DividendBreakdown,
  JurisdictionResult,
  MaritalStatus,
  ProvinceTaxProfile,
  RateTable,
  T1Lines,
  T1Result,
} from '@/lib/tax/t1/types'

// ---------------------------------------------------------------------------
// CRA line numbers used by the engine (string keys into T1Lines).
// ---------------------------------------------------------------------------

const LINE = {
  // Income
  ELIGIBLE_TAXABLE: '12000', // taxable amount of eligible + non-eligible dividends
  NONELIGIBLE_TAXABLE: '12010', // taxable amount of non-eligible (other) dividends
  OTHER_INCOME: '13000', // misc other income (opt-in)
  TAXABLE_CAP_GAINS: '12700', // taxable capital gains (S3, opt-in)
  T4A_INCOME: '13010', // T4A income (opt-in)
  TOTAL_INCOME: '15000',
  // Deductions → net income
  RRSP_DEDUCTION: '20800', // single user-entered number from the NOA
  OTHER_DEDUCTIONS: '23200',
  NET_INCOME: '23600',
  // Division C → taxable income
  DIVISION_C: '25000',
  TAXABLE_INCOME: '26000',
  // Federal non-refundable credits (base amounts)
  FED_BPA: '30000',
  FED_SPOUSE: '30300',
  FED_AGE: '30100',
  FED_MEDICAL: '33200', // allowable medical (post-floor) — opt-in
  FED_DONATIONS: '34900', // donations base — opt-in
  FED_NRTC_VALUE: '35000', // total federal non-refundable tax credits (valued)
  FED_TOPUP: '34990', // gated Top-Up credit (valued) — $0 here
  // Federal tax + dividend credit + clamp
  FED_GROSS_TAX: '40400',
  FED_DTC: '40425', // federal dividend tax credit consumed from slips
  FED_NET_TAX: '42000',
  // Alberta (AB428)
  AB_BPA: '58040',
  AB_SPOUSE: '58120',
  AB_AGE: '58080',
  AB_DONATIONS: '58969', // AB donations base — opt-in
  AB_NRTC_VALUE: '58800', // total AB non-refundable tax credits (valued)
  AB_GROSS_TAX: '42800GROSS', // synthetic key (no single CRA line) for cross-check
  AB_DTC: '61520', // AB dividend tax credit (RECOMPUTED)
  AB_NET_TAX: '42800',
  // Summary
  TOTAL_PAYABLE: '43500',
  WITHHOLDING: '43700',
  INSTALMENTS: '47600',
  REFUND: '48400',
  BALANCE_OWING: '48500',
} as const

// ---------------------------------------------------------------------------
// Context the route/build layer threads in (identity + dividend sub-totals).
// ---------------------------------------------------------------------------

export interface ComputeT1Context {
  maritalStatus: MaritalStatus
  /** spouse's line 23600 (her net income). Required when coupled (verified upstream). */
  spouseNetIncome: number | null
  /** filer DOB (drives the age amount). null → age amount = $0. */
  dateOfBirth: Date | null
  /** dividend sub-totals threaded through the income-tested credit math. */
  dividends: DividendBreakdown
}

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

/** Effective value of a line (default 0 when absent). */
function lineOf(lines: T1Lines, key: string): number {
  const v = lines[key]
  return Number.isFinite(v) ? (v as number) : 0
}

/** Progressive bracket tax on `taxableIncome`. */
function bracketTax(taxableIncome: number, brackets: Bracket[]): number {
  if (taxableIncome <= 0 || brackets.length === 0) return 0
  let tax = 0
  let lower = 0
  for (const b of brackets) {
    const upper = Math.min(taxableIncome, b.upTo)
    if (upper > lower) tax += (upper - lower) * b.rate
    lower = upper
    if (taxableIncome <= b.upTo) break
  }
  return tax
}

/**
 * Basic Personal Amount AFTER the federal net-income phase-out (REAL).
 * AB (phaseOut:null) → flat `max`. Federal → linear from `max` (at start) down to
 * `min` (at/after end). NOT rounded to whole dollars here — kept precise so the
 * valued credit matches a hand calc within rounding.
 */
function bpaAfterPhaseOut(profile: ProvinceTaxProfile, netIncome: number): number {
  const { max, min, phaseOut } = profile.bpa
  if (!phaseOut) return max
  if (netIncome <= phaseOut.start) return max
  if (netIncome >= phaseOut.end) return min
  const span = phaseOut.end - phaseOut.start
  const reduction = (max - min) * ((netIncome - phaseOut.start) / span)
  return max - reduction
}

/** Filer age at Dec 31 of the tax year (whole years). null DOB → null. */
function ageAtYearEnd(dob: Date | null, taxYear: number): number | null {
  if (!dob) return null
  const yearEnd = new Date(Date.UTC(taxYear, 11, 31))
  let age = yearEnd.getUTCFullYear() - dob.getUTCFullYear()
  const m = yearEnd.getUTCMonth() - dob.getUTCMonth()
  if (m < 0 || (m === 0 && yearEnd.getUTCDate() < dob.getUTCDate())) age -= 1
  return age
}

/**
 * Income-tested age amount BASE (line 30100 / 58080). $0 unless the filer is at
 * least the qualifying age at year-end. Clawed back at `rate` on net income over
 * `clawbackStart`. For a working-age dividend owner this is $0.
 */
function ageAmountBase(
  profile: ProvinceTaxProfile,
  age: number | null,
  netIncome: number,
): number {
  if (age === null || age < profile.ageAmount.qualifyingAge) return 0
  const { max, clawbackStart, rate } = profile.ageAmount
  const clawback = Math.max(0, (netIncome - clawbackStart) * rate)
  return Math.max(0, max - clawback)
}

/** Tiered donation credit VALUE. Federal adds a high-income top tier; AB does not. */
function donationCredit(
  profile: ProvinceTaxProfile,
  donations: number,
  taxableIncome: number,
): number {
  if (donations <= 0) return 0
  const t = profile.donationTiers
  const first = Math.min(donations, t.firstTierCap)
  const remainder = Math.max(0, donations - t.firstTierCap)
  let value = first * t.firstRate
  if (t.topRate !== null && t.topThreshold !== null) {
    // Federal: 33% on the lesser of (donations over $200) and (taxable income
    // over the top threshold); the rest of the remainder at remainderRate.
    const topEligible = Math.max(0, Math.min(remainder, taxableIncome - t.topThreshold))
    value += topEligible * t.topRate
    value += (remainder - topEligible) * t.remainderRate
  } else {
    value += remainder * t.remainderRate
  }
  return value
}

// ---------------------------------------------------------------------------
// Per-jurisdiction computation.
// ---------------------------------------------------------------------------

interface JurisdictionInputs {
  profile: ProvinceTaxProfile
  netIncome: number
  taxableIncome: number
  age: number | null
  coupled: boolean
  spouseNetIncome: number
  dividends: DividendBreakdown
  donations: number
  /** federal dividend tax credit consumed from the slip boxes (line 40425). */
  fedDtcFromSlips: number
  isFederal: boolean
}

interface JurisdictionComputation extends JurisdictionResult {
  bpaBase: number
  spouseBase: number
  ageBase: number
  /** Σ NRTC BASE amounts (pre-valuation) for the supplemental gate. */
  creditBaseAmounts: number
}

function computeJurisdiction(j: JurisdictionInputs): JurisdictionComputation {
  const { profile, netIncome, taxableIncome, age, coupled, spouseNetIncome, dividends } = j

  // --- income-tested credit BASE amounts (keyed off net income) ---
  const bpaBase = bpaAfterPhaseOut(profile, netIncome)

  // Spouse amount with the jurisdiction's OWN base: federal uses the live phased
  // BPA (config base === null); Alberta uses its fixed full BPA (22,323).
  let spouseBase = 0
  if (coupled) {
    const base = profile.spouseAmount.base ?? bpaBase
    spouseBase = Math.max(0, base - spouseNetIncome)
  }

  const ageBase = ageAmountBase(profile, age, netIncome)

  // Σ NRTC base amounts valued at the jurisdiction credit rate (donations are
  // tiered separately; the DTC is a direct credit, not an NRTC base).
  const nrtcBase = bpaBase + spouseBase + ageBase
  const nonRefundableCredits = round2(nrtcBase * profile.creditRate)
  const spouseAmountCredit = round2(spouseBase * profile.creditRate)

  // --- gross tax on taxable income ---
  const grossTax = round2(bracketTax(taxableIncome, profile.brackets))

  // --- donations (tiered, opt-in) ---
  const donationCreditValue = round2(donationCredit(profile, j.donations, taxableIncome))

  // --- dividend tax credit ---
  // Federal: consume the credit already on the slips (line 40425).
  // Alberta:  RECOMPUTE at the AB rates on the grossed-up taxable amounts —
  //           NEVER copy the federal box.
  let dividendTaxCredit: number
  if (j.isFederal) {
    dividendTaxCredit = round2(j.fedDtcFromSlips)
  } else {
    dividendTaxCredit = round2(
      dividends.taxableEligible * profile.dtc.eligible +
        dividends.taxableNonEligible * profile.dtc.nonEligible,
    )
  }

  // --- gated supplemental / Top-Up hook ($0 for this filer) ---
  const supplementalCredit = round2(
    profile.supplementalCredit?.({
      taxYear: profile.taxYear,
      netIncome,
      taxableIncome,
      creditBaseAmounts: nrtcBase,
      provincialCreditAmounts: nrtcBase,
    }) ?? 0,
  )

  // --- surtax (AB has none) ---
  const surtax = round2(profile.surtax?.(grossTax) ?? 0)

  // --- clamp: no excess non-refundable credit may create a refund ---
  const credited =
    nonRefundableCredits +
    donationCreditValue +
    dividendTaxCredit +
    supplementalCredit
  const netTax = round2(Math.max(0, grossTax + surtax - credited))

  return {
    jurisdiction: profile.jurisdiction,
    grossTax,
    nonRefundableCredits,
    donationCredit: donationCreditValue,
    dividendTaxCredit,
    supplementalCredit,
    spouseAmountCredit,
    surtax,
    netTax,
    bpaBase,
    spouseBase,
    ageBase,
    creditBaseAmounts: nrtcBase,
  }
}

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Compute the full T1 from the effective lines + rate table + identity context.
 * Pure: no DB, no clock, no randomness. Re-runnable for drift detection.
 */
export function computeT1(
  effectiveLines: T1Lines,
  rateTable: RateTable,
  ctx: ComputeT1Context,
): T1Result {
  const fedProfile = rateTable.federal
  const abProfile = rateTable.provincial
  const { dividends } = ctx

  // ---- 1. total income (15000) ----
  // Dividends (taxable, grossed-up) dominate; capital gains / T4A / other are
  // opt-in lines that default to absent ($0).
  const dividendTaxableTotal = round2(
    dividends.taxableEligible + dividends.taxableNonEligible,
  )
  const totalIncome = round2(
    dividendTaxableTotal +
      lineOf(effectiveLines, LINE.TAXABLE_CAP_GAINS) +
      lineOf(effectiveLines, LINE.T4A_INCOME) +
      lineOf(effectiveLines, LINE.OTHER_INCOME),
  )

  // ---- 2. net income (23600, grossed-up) ----
  const deductions = round2(
    lineOf(effectiveLines, LINE.RRSP_DEDUCTION) +
      lineOf(effectiveLines, LINE.OTHER_DEDUCTIONS),
  )
  const netIncome = round2(Math.max(0, totalIncome - deductions))

  // ---- 4. taxable income (26000) ----
  const divisionC = round2(lineOf(effectiveLines, LINE.DIVISION_C))
  const taxableIncome = round2(Math.max(0, netIncome - divisionC))

  // ---- identity context ----
  const coupled = COUPLED_STATUSES.includes(ctx.maritalStatus)
  const spouseNetIncome = coupled ? Math.max(0, ctx.spouseNetIncome ?? 0) : 0
  const age = ageAtYearEnd(ctx.dateOfBirth, rateTable.taxYear)

  // Donations are opt-in (default absent). Each jurisdiction reads its own line.
  const fedDonations = lineOf(effectiveLines, LINE.FED_DONATIONS)
  const abDonations = lineOf(effectiveLines, LINE.AB_DONATIONS) || fedDonations

  // ---- 5–7. per-jurisdiction tax + credits + clamp ----
  const federal = computeJurisdiction({
    profile: fedProfile,
    netIncome,
    taxableIncome,
    age,
    coupled,
    spouseNetIncome,
    dividends,
    donations: fedDonations,
    fedDtcFromSlips: dividends.federalDtc,
    isFederal: true,
  })
  const provincial = computeJurisdiction({
    profile: abProfile,
    netIncome,
    taxableIncome,
    age,
    coupled,
    spouseNetIncome,
    dividends,
    donations: abDonations,
    fedDtcFromSlips: 0,
    isFederal: false,
  })

  // ---- 8. total payable (43500) ----
  const totalPayable = round2(federal.netTax + provincial.netTax)

  // ---- 9. withholding + instalments → refund / owing ----
  const withholding = round2(lineOf(effectiveLines, LINE.WITHHOLDING))
  const instalments = round2(lineOf(effectiveLines, LINE.INSTALMENTS))
  const totalCredits = round2(withholding + instalments)
  const net = round2(totalPayable - totalCredits)
  const refund = net < 0 ? round2(-net) : 0
  const balanceOwing = net > 0 ? net : 0

  // ---- engine version ----
  const engineVersion = makeEngineVersion(rateTable.taxYear, rateTable.rateVersion)

  // ---- assemble the line snapshot the engine touched ----
  const lines: T1Lines = {
    ...effectiveLines,
    [LINE.ELIGIBLE_TAXABLE]: dividendTaxableTotal,
    [LINE.NONELIGIBLE_TAXABLE]: round2(dividends.taxableNonEligible),
    [LINE.TOTAL_INCOME]: totalIncome,
    [LINE.NET_INCOME]: netIncome,
    [LINE.TAXABLE_INCOME]: taxableIncome,
    // Federal credit detail
    [LINE.FED_BPA]: round2(federal.bpaBase),
    [LINE.FED_SPOUSE]: round2(federal.spouseBase),
    [LINE.FED_AGE]: round2(federal.ageBase),
    [LINE.FED_NRTC_VALUE]: federal.nonRefundableCredits,
    [LINE.FED_TOPUP]: federal.supplementalCredit,
    [LINE.FED_GROSS_TAX]: federal.grossTax,
    [LINE.FED_DTC]: federal.dividendTaxCredit,
    [LINE.FED_NET_TAX]: federal.netTax,
    // Alberta credit detail
    [LINE.AB_BPA]: round2(provincial.bpaBase),
    [LINE.AB_SPOUSE]: round2(provincial.spouseBase),
    [LINE.AB_AGE]: round2(provincial.ageBase),
    [LINE.AB_NRTC_VALUE]: provincial.nonRefundableCredits,
    [LINE.AB_GROSS_TAX]: provincial.grossTax,
    [LINE.AB_DTC]: provincial.dividendTaxCredit,
    [LINE.AB_NET_TAX]: provincial.netTax,
    // Summary
    [LINE.TOTAL_PAYABLE]: totalPayable,
    [LINE.WITHHOLDING]: withholding,
    [LINE.INSTALMENTS]: instalments,
    [LINE.REFUND]: refund,
    [LINE.BALANCE_OWING]: balanceOwing,
  }

  return {
    taxYear: rateTable.taxYear,
    province: rateTable.province,
    lines,
    totalIncome,
    netIncome,
    taxableIncome,
    dividends,
    federal: stripInternal(federal),
    provincial: stripInternal(provincial),
    totalPayable,
    totalCredits,
    refund,
    balanceOwing,
    engineVersion,
  }
}

/** Drop the internal-only fields so the result matches `JurisdictionResult`. */
function stripInternal(j: JurisdictionComputation): JurisdictionResult {
  return {
    jurisdiction: j.jurisdiction,
    grossTax: j.grossTax,
    nonRefundableCredits: j.nonRefundableCredits,
    donationCredit: j.donationCredit,
    dividendTaxCredit: j.dividendTaxCredit,
    supplementalCredit: j.supplementalCredit,
    spouseAmountCredit: j.spouseAmountCredit,
    surtax: j.surtax,
    netTax: j.netTax,
  }
}
