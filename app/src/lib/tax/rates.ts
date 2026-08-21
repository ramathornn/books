/**
 * CRA dividend gross-up / dividend-tax-credit (DTC) factors, plus CCA
 * Accelerated Investment Incentive (AccII) factors, keyed by tax year.
 *
 * These are the federal statutory factors. The locked 2025 case is the
 * authority for the pinned values:
 *   non-eligible: gross-up 0.15, federal DTC 9/13 of gross-up = 0.090301 of the
 *   taxable amount. eligible: gross-up 0.38, federal DTC 6/11 of gross-up =
 *   0.150198 of the taxable amount.
 *
 * Box 11 (taxable) = round2(box10 * (1 + grossUp))
 * Box 12 (DTC)     = round2(box11 * dtcOfTaxable)
 *
 * Pure data + lookups; no I/O. Unknown years fall back to the latest defined
 * year (factors change rarely; callers can override per-year when CRA revises).
 */

export interface DividendFactors {
  /** gross-up rate applied to the actual dividend (e.g. 0.15 non-eligible). */
  grossUp: number
  /** federal DTC expressed as a fraction of the *taxable* (grossed-up) amount. */
  dtcOfTaxable: number
}

export interface DividendRateTable {
  nonEligible: DividendFactors
  eligible: DividendFactors
}

// Keyed by tax year. Non-eligible 2019+ has been 0.15 / 0.090301; eligible has
// been 0.38 / 0.150198. Add new years here when CRA revises a factor.
const DIVIDEND_RATES: Record<number, DividendRateTable> = {
  2023: {
    nonEligible: { grossUp: 0.15, dtcOfTaxable: 0.090301 },
    eligible: { grossUp: 0.38, dtcOfTaxable: 0.150198 },
  },
  2024: {
    nonEligible: { grossUp: 0.15, dtcOfTaxable: 0.090301 },
    eligible: { grossUp: 0.38, dtcOfTaxable: 0.150198 },
  },
  2025: {
    nonEligible: { grossUp: 0.15, dtcOfTaxable: 0.090301 },
    eligible: { grossUp: 0.38, dtcOfTaxable: 0.150198 },
  },
}

const LATEST_DIVIDEND_YEAR = Math.max(...Object.keys(DIVIDEND_RATES).map(Number))

export function dividendRates(taxYear: number): DividendRateTable {
  return DIVIDEND_RATES[taxYear] ?? DIVIDEND_RATES[LATEST_DIVIDEND_YEAR]
}

/**
 * AccII (Accelerated Investment Incentive) first-year uplift factor.
 *
 * For most CCA classes acquired and available-for-use after 2018 and before
 * 2024, the half-year rule is suspended and the first-year addition is uplifted
 * by 0.5× (i.e. base = additions * 1.5). The incentive phases out 2024-2027.
 * These are reference defaults ONLY — design doc §6 Q6 flags that the exact
 * 2025 factor must be verified against current CRA Schedule 8 before relying on
 * it for filing; the CCA editor exposes a per-class override.
 */
export interface AccIiFactors {
  /** multiplier on net additions for the first-year accelerated base. */
  upliftMultiplier: number
}

const ACCII_FACTORS: Record<number, AccIiFactors> = {
  2023: { upliftMultiplier: 1.5 },
  2024: { upliftMultiplier: 1.5 }, // start of phase-out; VERIFY against CRA Sch 8
  2025: { upliftMultiplier: 1.5 }, // VERIFY against CRA Sch 8 (design §6 Q6)
}

const LATEST_ACCII_YEAR = Math.max(...Object.keys(ACCII_FACTORS).map(Number))

export function accIiFactors(taxYear: number): AccIiFactors {
  return ACCII_FACTORS[taxYear] ?? ACCII_FACTORS[LATEST_ACCII_YEAR]
}
