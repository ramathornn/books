/**
 * AccII (Accelerated Investment Incentive) + immediate-expensing (DIEP) rate
 * table — per CCA class × per acquisition / available-for-use date.
 *
 * This REPLACES the single scalar `ACCII_FACTORS = 1.5` in '@/lib/tax/rates'
 * (which is structurally incapable of being correct because the uplift is
 * date-gated and depends on whether the half-year rule applies). The Schedule 8
 * projection threads each asset's available-for-use date through `acciiForAsset`.
 *
 * ── CONFIRMED 2025 mechanics (CRA "Accelerated investment incentive", canada.ca) ──
 * The incentive's general rule has two parts: SUSPEND the half-year rule AND
 * apply the class CCA rate to an UPLIFTED net addition for the year.
 *
 *  - Property available-for-use BEFORE 2024 (full incentive): the enhanced
 *    first-year allowance is 1.5× the net addition (uplift multiplier 1.5) for a
 *    class that would normally be half-year, and 1.25× for a class that would not
 *    normally be half-year (e.g. Class 13/14).
 *  - PHASE-OUT, available-for-use 2024–2027 (the band a Dec-31-2025 FYE lands in):
 *    for a half-year-rule class the enhanced first-year allowance is "TWO TIMES
 *    the normal first-year CCA deduction". Because the engine applies the uplift
 *    to the *base* (claim = rate × (1 + (uplift−1)) × netAdd) with the half-year
 *    rule suspended, an UPLIFT MULTIPLIER of 1.5 on the base produces exactly
 *    `rate × 1.5 × netAdd`, i.e. 2× the normal half-year claim of
 *    `rate × 0.5 × netAdd`. So the 2025 general factor is **1.5 on the base
 *    (= 2× the normal claim)** — the existing scalar value was right; only its
 *    date/class gating and the "1.5 vs 2×" framing were ambiguous. For a class
 *    that would NOT normally be half-year, the 2024–2027 factor is 1.25× the
 *    normal first-year deduction.
 *  - DIEP / immediate-expensing (method='diep', $1.5M temporary measure): the
 *    window CLOSED for property available-for-use after 2023. It is HARD-GATED
 *    OFF for post-2023 acquisitions with an ERROR (see `immediateExpensingGate`).
 *
 * [VERIFY] Budget 2025 (Bill C-15, tabled 2025-11-18) proposed a "reaccelerated"
 * 100% / higher first-year write-off for qualifying M&P / clean-energy property
 * acquired on/after 2025-01-01. That bill was NOT enacted law for a 2025 FYE at
 * build time, so v1 ships the LEGISLATED phase-out band above and flags the C-15
 * reinstatement as unconfirmed. AccII is minor-dollar for this persona
 * (equipment only) and MUST NOT gate v1.
 *
 * Sources:
 *  - https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/sole-proprietorships-partnerships/report-business-income-expenses/claiming-capital-cost-allowance/accelerated-investment-incentive.html
 *  - EY Tax Alert 2025 No. 58 (Bill C-15, Budget 2025) — [VERIFY] reaccelerated measure.
 *
 * Pure data + lookups; no I/O.
 */

/** The AccII year this table encodes — folded into engineVersion (acciiYear). */
export const ACCII_TABLE_YEAR = 2025

/** Classes that benefit from full expensing and are EXCLUDED from AccII uplift. */
const FULL_EXPENSING_EXCLUDED_CLASSES = new Set([
  '43.1',
  '43.2',
  '53',
  '54',
  '55',
  '56',
])

/**
 * Uplift multiplier applied to the net addition's BASE for an asset, given the
 * class's half-year-rule status and the asset's available-for-use date.
 *
 * Returns 1.0 (no uplift) when:
 *  - the date is outside the incentive window, or
 *  - the class is full-expensing-excluded.
 *
 * The phase-out date band (2024–2027) is the operative band for a 2025 FYE; a
 * later phase-out (2028+) tapers further but is out of scope for the v1 persona
 * and conservatively returns 1.0 (no uplift) with no error — AccII is minor.
 */
export function acciiUplift(params: {
  classNumber: string
  halfYearRuleApplies: boolean
  availableForUse: Date
}): number {
  const { classNumber, halfYearRuleApplies, availableForUse } = params
  if (FULL_EXPENSING_EXCLUDED_CLASSES.has(classNumber)) return 1.0

  const year = availableForUse.getUTCFullYear()
  // Incentive applies to property available-for-use after 2018. Before 2024 the
  // full incentive applies; 2024–2027 is the phase-out band a 2025 FYE lands in.
  if (year < 2019) return 1.0

  if (year <= 2027) {
    // Half-year-rule class → 1.5 on the base (= 2× the normal first-year claim);
    // non-half-year-rule class → 1.25 on the base.
    return halfYearRuleApplies ? 1.5 : 1.25
  }

  // [VERIFY] 2028+ tapers to nil by 2030 under the legislated schedule; out of
  // scope for the v1 persona. Conservatively no uplift (does not gate v1).
  return 1.0
}

/**
 * Hard gate for immediate expensing (DIEP / method='diep'): the temporary $1.5M
 * measure CLOSED for property available-for-use after 2023. Returns an error
 * code/message when an asset acquired/available after 2023 is flagged for DIEP,
 * else null. The Schedule 8 projection raises this as a verify ERROR (blocker 4).
 */
export function immediateExpensingGate(availableForUse: Date): { code: string; message: string } | null {
  if (availableForUse.getUTCFullYear() > 2023) {
    return {
      code: 'DIEP_EXPIRED',
      message:
        'Immediate expensing (DIEP) does not apply to property available for use after 2023; the $1.5M temporary measure expired. Use the regular AccII / declining-balance method.',
    }
  }
  return null
}

/** Short stable hash inputs for engineVersion (the table year + a content tag). */
export const ACCII_VERSION = `${ACCII_TABLE_YEAR}.1`
