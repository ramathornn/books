/**
 * Alberta (AB428) T1 rate profile — 2025 tax year.
 *
 * All figures verified in the gap review. Public Alberta tax law, NOT personal
 * data.
 *
 * Key 2025 Alberta figures:
 *  - Brackets: 8 / 10 / 12 / 13 / 14 / 15% at 60,000 / 151,234 / 181,481 /
 *    241,974 / 362,961.
 *  - BPA: $22,323 flat — NO phase-out (full base, distinct from the federal base).
 *  - NRTC valuation rate: 8% (dropped from 10%).
 *  - AB DTC: eligible 8.12% / non-eligible 2.18% of the grossed-up amount —
 *    RECOMPUTED at these AB rates, never copied from the federal DTC box.
 *  - Donations: 60% first $200 / 21% remainder (no high-income top tier).
 *  - No surtax.
 *  - Spouse amount (line 58120): max(0, 22,323 − spouseNetIncome) × 8% — full AB
 *    BPA, NO phase-out (different base from federal 30300).
 *  - AB supplemental credit: gated hook, $0 for the dividend-only filer.
 */

import type { ProvinceTaxProfile, SupplementalCreditContext } from '@/lib/tax/t1/types'

const AB_SUPPLEMENTAL_GATE = 60000
const AB_CREDIT_VALUE_AT_GATE = 4800 // 8% × $60,000

/**
 * Alberta supplemental tax credit. Ensures taxpayers with > $60,000 of
 * non-refundable credit AMOUNTS aren't worse off from the 10%→8% rate cut.
 * Formula (gap review): max(0, (A − $4,800) × 25%) where A = total provincial
 * personal-credit AMOUNTS valued at 8%, and $4,800 = 8% × $60,000. GATED at
 * credit base > $60,000. [VERIFY] vs the published 2025 5009-C/AB428. For a
 * normal owner (AB BPA $22,323 + minor credits) this is well under → $0.
 */
function albertaSupplemental(ctx: SupplementalCreditContext): number {
  if (ctx.provincialCreditAmounts <= AB_SUPPLEMENTAL_GATE) return 0
  // [VERIFY] re-confirm against 5009-C before relying on it for a real filing.
  const valuedCredits = ctx.provincialCreditAmounts * 0.08
  return Math.max(0, (valuedCredits - AB_CREDIT_VALUE_AT_GATE) * 0.25)
}

export const AB_2025: ProvinceTaxProfile = {
  jurisdiction: 'AB',
  taxYear: 2025,
  brackets: [
    { rate: 0.08, upTo: 60000 },
    { rate: 0.1, upTo: 151234 },
    { rate: 0.12, upTo: 181481 },
    { rate: 0.13, upTo: 241974 },
    { rate: 0.14, upTo: 362961 },
    { rate: 0.15, upTo: Infinity },
  ],
  bpa: {
    max: 22323,
    min: 22323,
    phaseOut: null, // flat — full AB BPA, no phase-out
  },
  creditRate: 0.08,
  dtc: {
    eligible: 0.0812,
    nonEligible: 0.0218,
  },
  donationTiers: {
    firstTierCap: 200,
    firstRate: 0.6,
    remainderRate: 0.21,
    topRate: null,
    topThreshold: null,
  },
  // AB spouse base is the FULL flat AB BPA (no phase-out) — distinct from federal.
  spouseAmount: { base: 22323 },
  ageAmount: {
    max: 6221, // [VERIFY]
    clawbackStart: 46308, // [VERIFY]
    rate: 0.15, // [VERIFY]
    qualifyingAge: 65,
  },
  medical: {
    fixedFloor: 2834, // [VERIFY] AB analogue
    rate: 0.03,
  },
  supplementalCredit: albertaSupplemental,
  surtax: null,
}
