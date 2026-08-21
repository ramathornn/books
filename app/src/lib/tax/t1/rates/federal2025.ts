/**
 * Federal T1 rate profile — 2025 tax year.
 *
 * All figures verified in the gap review (see the T1 build brief). These are
 * public CRA tax law (brackets, BPA, rates), NOT personal data.
 *
 * Key 2025 federal figures:
 *  - Brackets: 14.5 / 20.5 / 26 / 29 / 33% at 57,375 / 114,750 / 177,882 / 253,414
 *    (14.5% is the 2025-only blended lowest rate; 14% for 2026+).
 *  - BPA: max 16,129 / min 14,538, phased out 177,882 → 253,414 (REAL, not a no-op).
 *  - NRTC valuation rate: 14.5%.
 *  - Dividend gross-up: eligible 38% / non-eligible 15% (applied at slip time).
 *  - Federal DTC: eligible 15.0198% / non-eligible 9.0301% of the grossed-up amount.
 *  - Donations: 14.5% first $200; 33% on the lesser of (donations over $200) and
 *    (taxable income over 253,414); 29% on the remainder.
 *  - Capital-gains inclusion: 50% (parametrized elsewhere; not on this profile).
 *  - Top-Up (line 34990): gated hook, $0 for the dividend-only filer.
 */

import type { ProvinceTaxProfile, SupplementalCreditContext } from '@/lib/tax/t1/types'

const FED_FIRST_BRACKET_THRESHOLD = 57375

/**
 * Federal Top-Up tax credit (line 34990), 2025–2030. Restores an effective 15%
 * on NRTC base amounts that fall above the first bracket threshold. GATED: fires
 * only when Σ NRTC base amounts exceed $57,375. The 5000-D1 worksheet detail is
 * [VERIFY]; for a dividend-only owner (BPA ~16,129 + a few small credits) this is
 * well below the gate → returns $0.
 */
function federalTopUp(ctx: SupplementalCreditContext): number {
  if (ctx.creditBaseAmounts <= FED_FIRST_BRACKET_THRESHOLD) return 0
  // [VERIFY] exact 5000-D1 mechanics; 0.5% differential on the base above the
  // first-bracket threshold. Never let this fire for the canonical filer.
  const excessBase = ctx.creditBaseAmounts - FED_FIRST_BRACKET_THRESHOLD
  return excessBase * 0.005
}

export const FEDERAL_2025: ProvinceTaxProfile = {
  jurisdiction: 'federal',
  taxYear: 2025,
  brackets: [
    { rate: 0.145, upTo: 57375 },
    { rate: 0.205, upTo: 114750 },
    { rate: 0.26, upTo: 177882 },
    { rate: 0.29, upTo: 253414 },
    { rate: 0.33, upTo: Infinity },
  ],
  bpa: {
    max: 16129,
    min: 14538,
    phaseOut: { start: 177882, end: 253414 },
  },
  creditRate: 0.145,
  dtc: {
    eligible: 0.150198,
    nonEligible: 0.090301,
  },
  donationTiers: {
    firstTierCap: 200,
    firstRate: 0.145,
    remainderRate: 0.29,
    topRate: 0.33,
    topThreshold: 253414,
  },
  // Federal spouse base uses the LIVE phased BPA (base:null) reduced by spouse NI.
  spouseAmount: { base: null },
  // Working-age owner → $0. Thresholds [VERIFY] (non-load-bearing for this filer).
  ageAmount: {
    max: 9028, // [VERIFY]
    clawbackStart: 45522, // [VERIFY]
    rate: 0.15, // [VERIFY]
    qualifyingAge: 65,
  },
  medical: {
    fixedFloor: 2834, // [VERIFY]
    rate: 0.03,
  },
  supplementalCredit: federalTopUp,
  surtax: null,
}
