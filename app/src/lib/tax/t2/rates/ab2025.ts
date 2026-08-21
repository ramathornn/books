/**
 * Alberta AT1 (corporate) rate profile — 2025 tax year.
 *
 * Public Alberta tax law (Alberta Corporate Tax Act; TRA), NOT personal data.
 *
 * Alberta is OUTSIDE the federal-provincial tax-collection agreement, so the
 * federal T2 carries no Alberta line — Alberta tax is a SEPARATE AT1 filed to
 * Alberta TRA. The AT1 carries none of the RDTOH / ART / Part IV / dividend-refund
 * / GRIP machinery (federal-only).
 *
 * Key 2025 Alberta figures:
 *  - General corporate income tax rate 8%; small-business rate 2% on the first
 *    $500,000 of ABI (Alberta's 6-point SBD spread).
 *  - Alberta business limit $500,000, following the federal REDUCED business
 *    limit (Alberta conformity — never recomputes the AAII grind provincially).
 *  - Income allocation factor 1.0 for a single Alberta permanent establishment.
 *  - Innovation Employment Grant (IEG, AT1 line 129): 8% base / 20% enhanced of
 *    eligible Alberta R&D already in the federal SR&ED pool — default $0.
 *  - Schedule 12 federal→Alberta income reconciliation: default $0.
 */

export interface AlbertaT2Rates {
  jurisdiction: 'AB'
  taxYear: number

  /** general corporate income tax rate (0.08). */
  generalRate: number
  /** small-business rate (0.02). */
  smallBusinessRate: number
  /** the SBD spread = general − small business (0.06), for the AB SBD amount. */
  sbdSpread: number
  /** Alberta business limit / SBD threshold (500_000). */
  businessLimit: number
  /** income allocation factor for a single Alberta PE (1.0). */
  allocationFactorDefault: number

  /** IEG base rate (0.08) and enhanced rate (0.20); claim defaults to $0. */
  iegBaseRate: number
  iegEnhancedRate: number

  /** Schedule 12 federal→Alberta reconciliation default ($0 adjustment). */
  scheduleTwelveDefault: number

  rateVersion: string
}

export const AB_T2_2025: AlbertaT2Rates = {
  jurisdiction: 'AB',
  taxYear: 2025,

  generalRate: 0.08,
  smallBusinessRate: 0.02,
  sbdSpread: 0.06,
  businessLimit: 500000,
  allocationFactorDefault: 1.0,

  iegBaseRate: 0.08,
  iegEnhancedRate: 0.2,

  scheduleTwelveDefault: 0,

  rateVersion: '2025.1',
}
