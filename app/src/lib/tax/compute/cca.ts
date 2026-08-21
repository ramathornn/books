import { round2 } from '@/lib/tax/round'
import { accIiFactors } from '@/lib/tax/rates'

/**
 * Capital Cost Allowance (CCA) — declining-balance with the half-year rule and
 * the Accelerated Investment Incentive (AccII), plus closing UCC.
 *
 * This module is PURE: it computes one class-year's CCA from explicit inputs.
 * The lock-aware recompute-forward / catch-up posting (design §4 Phase 6) lives
 * in the route layer; this function never touches the DB or period locks.
 *
 * Standard (half-year) base:
 *   netAdditions = additions − dispositions
 *   halfYearAdjustment = max(0, netAdditions) / 2      (only on net positive)
 *   base = opening + additions − dispositions − halfYearAdjustment
 *
 * AccII (eligible additions, year in incentive window): the half-year rule is
 * suspended and net additions are uplifted instead:
 *   accIiAddition = max(0, netAdditions) * (upliftMultiplier − 1)
 *   base = opening + additions − dispositions + accIiAddition
 *
 * claim   = min(round2(base * rate), max(0, ucc-before-claim))
 * closing = opening + additions − dispositions − claim
 *
 * Closing UCC may be negative (recapture) or, with no assets left, positive
 * (terminal loss) — both are surfaced as flags rather than silently zeroed.
 */

export type CcaMethod = 'half_year' | 'accii' | 'full' | 'none'

export interface CcaComputeInput {
  taxYear: number
  classNumber: string
  rate: number // declining-balance rate, e.g. 0.30 for class 10
  openingUcc: number
  additions: number
  dispositions: number
  /** apply the half-year rule to net additions (default true). */
  halfYearRuleApplies?: boolean
  /** treat additions as AccII-eligible (suspends half-year, applies uplift). */
  accIiEligible?: boolean
  method?: CcaMethod
}

export interface CcaComputeResult {
  taxYear: number
  classNumber: string
  ccaRate: number
  openingUcc: number
  additions: number
  dispositions: number
  halfYearAdjustment: number
  accIiAddition: number
  ccaBase: number
  ccaMax: number
  ccaClaimed: number
  closingUcc: number
  method: CcaMethod
  /** closing < 0: negative balance ⇒ recapture of CCA into income. */
  recapture: boolean
  /** UCC remains but the class is empty (all disposed) ⇒ terminal loss. */
  terminalLossPossible: boolean
}

export function computeCca(input: CcaComputeInput): CcaComputeResult {
  const {
    taxYear,
    classNumber,
    rate,
    openingUcc,
    additions,
    dispositions,
    halfYearRuleApplies = true,
    accIiEligible = false,
  } = input

  const netAdditions = round2(additions - dispositions)
  const uccBeforeClaim = round2(openingUcc + additions - dispositions)

  let halfYearAdjustment = 0
  let accIiAddition = 0
  let method: CcaMethod = input.method ?? 'half_year'

  if (accIiEligible) {
    const uplift = accIiFactors(taxYear).upliftMultiplier
    accIiAddition = round2(Math.max(0, netAdditions) * (uplift - 1))
    method = 'accii'
  } else if (halfYearRuleApplies) {
    halfYearAdjustment = round2(Math.max(0, netAdditions) / 2)
    method = 'half_year'
  } else {
    method = 'full'
  }

  // CCA base for the rate: the UCC less the half-year holdback, or plus the
  // AccII uplift. Never below zero.
  const ccaBase = round2(Math.max(0, uccBeforeClaim - halfYearAdjustment + accIiAddition))

  // Maximum allowable claim, capped so closing UCC can't go below zero from the
  // claim alone (a negative balance comes from dispositions, not the claim).
  const ccaMax = round2(Math.min(round2(ccaBase * rate), Math.max(0, uccBeforeClaim)))
  const ccaClaimed = ccaMax

  const closingUcc = round2(uccBeforeClaim - ccaClaimed)

  return {
    taxYear,
    classNumber,
    ccaRate: rate,
    openingUcc: round2(openingUcc),
    additions: round2(additions),
    dispositions: round2(dispositions),
    halfYearAdjustment,
    accIiAddition,
    ccaBase,
    ccaMax,
    ccaClaimed,
    closingUcc,
    method,
    recapture: closingUcc < 0,
    terminalLossPossible: closingUcc > 0 && uccBeforeClaim > 0 && additions === 0 && dispositions > 0,
  }
}
