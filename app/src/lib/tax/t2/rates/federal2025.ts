/**
 * Federal T2 (corporate) rate profile — 2025 tax year.
 *
 * Public CRA tax law (ITA rates, thresholds), NOT personal data. Every figure is
 * a generic statutory constant; nothing here is a real corporate value.
 *
 * Key 2025 federal CCPC figures (all verified in the gap review):
 *  - Basic Part I rate 38% (ITA 123(1)(a)); provincial abatement 10% (124(1));
 *    general rate reduction 13% (123.4(2)) → net general 15%.
 *  - Small business deduction rate 19% (125(1.1)) → net small-business 9%.
 *  - Business limit $500,000 (125(2)).
 *  - SBD grind = GREATER of the taxable-capital grind and the prior-year AAII
 *    grind (ITA 125(5.1)); NOT the sum. AAII grind: $5 of limit lost per $1 of
 *    PRIOR-year AAII over $50,000, nil at $150,000. Taxable-capital grind band
 *    $10M–$50M.
 *  - ART (additional refundable tax on AII) 10⅔% (0.1067) × min(AII, TI) (123.3).
 *  - NERDTOH addition on AII 30⅔% (0.3067); Part IV / RDTOH addition 38⅓%
 *    (0.3833); ERDTOH addition on eligible Part IV 38⅓%.
 *  - Dividend refund 38⅓%, pool-specific (129(1)).
 *  - GRIP addition factor 0.72 × full-rate taxable income (89(1)).
 *  - Capital gains inclusion 50% (the ⅔ increase was cancelled, 2025).
 *  - PSB additional tax +5% (123.5), no SBD, no GRR.
 *
 * fullRateTaxableIncome = TI − sbdIncome − AII (ITA 123.4(1)).
 * Part I = 0.38×TI − 0.10×abatement − 0.13×fullRateTI − 0.19×sbdIncome + ART
 *          (+ 0.05×psbTaxableIncome when PSB).
 */

export interface FederalT2Rates {
  jurisdiction: 'federal'
  taxYear: number

  /** basic Part I rate before reductions (0.38). */
  basicRate: number
  /** provincial abatement on income earned in a province (0.10; 100% for AB). */
  abatementRate: number
  /** general rate reduction on full-rate taxable income (0.13). */
  generalRateReduction: number
  /** small business deduction rate (0.19). */
  sbdRate: number
  /** net small-business rate, for cross-checks (0.09). */
  netSmallBusinessRate: number
  /** net general corporate rate, for cross-checks (0.15). */
  netGeneralRate: number

  /** business limit (500_000). */
  businessLimit: number
  /** AAII passive grind: limit lost per $1 prior-year AAII over the threshold. */
  aaiiGrindPerDollar: number
  /** AAII grind starts at $50,000 prior-year AAII. */
  aaiiGrindThreshold: number
  /** AAII grind reaches nil business limit at $150,000 prior-year AAII. */
  aaiiGrindCeiling: number
  /** taxable-capital grind band lower edge ($10M). */
  taxableCapitalGrindStart: number
  /** taxable-capital grind band upper edge ($50M → nil limit). */
  taxableCapitalGrindEnd: number

  /** additional refundable tax on AII (0.1067). */
  artRate: number
  /** NERDTOH addition on AII (0.3067). */
  nerdtohOnAiiRate: number
  /** Part IV tax / RDTOH addition rate on portfolio dividends (0.3833). */
  partFourRate: number
  /** dividend refund rate, pool-specific (0.3833). */
  dividendRefundRate: number

  /** GRIP addition factor on full-rate taxable income (0.72). */
  gripFactor: number
  /** capital gains inclusion rate (0.50). */
  capitalGainsInclusion: number
  /** PSB additional tax rate (0.05). */
  psbAdditionalRate: number

  /** semantic version of these figures, folded into the engine hash. */
  rateVersion: string
}

export const FEDERAL_T2_2025: FederalT2Rates = {
  jurisdiction: 'federal',
  taxYear: 2025,

  basicRate: 0.38,
  abatementRate: 0.1,
  generalRateReduction: 0.13,
  sbdRate: 0.19,
  netSmallBusinessRate: 0.09,
  netGeneralRate: 0.15,

  businessLimit: 500000,
  aaiiGrindPerDollar: 5,
  aaiiGrindThreshold: 50000,
  aaiiGrindCeiling: 150000,
  taxableCapitalGrindStart: 10000000,
  taxableCapitalGrindEnd: 50000000,

  artRate: 0.1067,
  nerdtohOnAiiRate: 0.3067,
  partFourRate: 0.3833,
  dividendRefundRate: 0.3833,

  gripFactor: 0.72,
  capitalGainsInclusion: 0.5,
  psbAdditionalRate: 0.05,

  rateVersion: '2025.1',
}
