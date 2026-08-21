/**
 * PURE Alberta AT1 compute engine — `computeAt1`.
 *
 * Same purity contract as `computeT2Federal`: a deterministic function over its
 * inputs with NO I/O. Alberta is OUTSIDE the federal-provincial tax-collection
 * agreement, so the AT1 is a SEPARATE return filed to Alberta TRA and carries
 * NONE of the federal RDTOH / ART / Part IV / dividend-refund / GRIP machinery —
 * just the rate split, the Alberta SBD, the Schedule-12 reconciliation, and the
 * Innovation Employment Grant.
 *
 * 2025 mechanics:
 *   - General rate 8%, small-business rate 2% on the first $500,000 ABI (the
 *     6-point Alberta SBD spread).
 *   - Alberta SBD base = reducedBusinessLimit × allocationFactor — Alberta
 *     INHERITS the federal reduced limit (never recomputes the AAII grind). For
 *     the v1 persona allocationFactor = 1.0 (a single Alberta PE).
 *   - A PSB earns no Alberta SBD (all income at the 8% general rate).
 *   - Schedule 12 federal→Alberta income reconciliation defaults to $0 (folded
 *     into albertaTaxableIncome by the caller).
 *   - IEG (AT1 line 129) defaults to $0 and is a straight credit against tax.
 *
 *   albertaSbdIncome   = isPsb ? 0 : min(ABI, reducedLimit × allocation, ABTI)
 *   generalRateIncome  = ABTI − albertaSbdIncome
 *   taxBeforeCredits   = 0.08 × generalRateIncome + 0.02 × albertaSbdIncome
 *                      = 0.08 × ABTI − 0.06 × albertaSbdIncome   (the SBD as a spread)
 *   albertaTaxPayable  = max(0, taxBeforeCredits − IEG)
 *
 * Pure data only — NO I/O in this file (mirrors compute/t5.ts, t1/compute.ts).
 */

import { round2 } from '@/lib/tax/round'
import type { AlbertaT2Rates } from '@/lib/tax/t2/rates/ab2025'
import type { At1Input, At1Result, AT1Lines } from '@/lib/tax/t2/types'

// ---------------------------------------------------------------------------
// AT1 line keys the engine writes (keyed "AT1:<line>").
// ---------------------------------------------------------------------------

const LINE = {
  TAXABLE_INCOME: 'AT1:068', // Alberta taxable income
  SBD_INCOME: 'AT1:061', // Alberta small-business income (the 2% base)
  SBD_AMOUNT: 'AT1:062', // Alberta SBD (the 6-point spread deduction)
  GENERAL_INCOME: 'AT1:063', // general-rate income (8%)
  TAX_BEFORE_CREDITS: 'AT1:070', // Alberta tax before credits
  IEG: 'AT1:129', // Innovation Employment Grant credit
  TAX_PAYABLE: 'AT1:072', // net Alberta tax payable
} as const

// ---------------------------------------------------------------------------
// Public entry point.
// ---------------------------------------------------------------------------

/**
 * Compute the Alberta AT1 result from the assembled input + rate profile. Pure:
 * no DB, no clock, no randomness. `engineVersion` is threaded in by the caller
 * so the federal/Alberta/AccII hashes line up in one string.
 */
export function computeAt1(
  input: At1Input,
  rates: AlbertaT2Rates,
  engineVersion: string,
): At1Result {
  const isPsb = input.isPersonalServicesBusiness

  const albertaTaxableIncome = round2(Math.max(0, input.albertaTaxableIncome))
  const abi = round2(Math.max(0, input.activeBusinessIncome))
  const reducedLimit = round2(Math.max(0, input.reducedBusinessLimit))
  const allocation = Number.isFinite(input.allocationFactor)
    ? Math.max(0, input.allocationFactor)
    : rates.allocationFactorDefault

  // ---- Alberta SBD income (no AB SBD for a PSB) ----
  const allocatedLimit = round2(reducedLimit * allocation)
  const albertaSbdIncome = isPsb
    ? 0
    : round2(Math.min(abi, allocatedLimit, albertaTaxableIncome))

  // SBD amount = the 6-point spread on the small-business income (the deduction
  // that takes those dollars from 8% down to 2%).
  const albertaSbdAmount = round2(albertaSbdIncome * rates.sbdSpread)

  // ---- general-rate income (8%) ----
  const generalRateIncome = round2(Math.max(0, albertaTaxableIncome - albertaSbdIncome))

  // ---- tax before credits ----
  const taxBeforeCredits = round2(
    generalRateIncome * rates.generalRate + albertaSbdIncome * rates.smallBusinessRate,
  )

  // ---- Innovation Employment Grant (AT1 line 129), default $0 ----
  const innovationEmploymentGrant = round2(Math.max(0, input.innovationEmploymentGrant))

  // ---- net Alberta tax payable, clamped ≥ 0 ----
  const albertaTaxPayable = round2(Math.max(0, taxBeforeCredits - innovationEmploymentGrant))

  const lines: AT1Lines = {
    [LINE.TAXABLE_INCOME]: albertaTaxableIncome,
    [LINE.SBD_INCOME]: albertaSbdIncome,
    [LINE.SBD_AMOUNT]: albertaSbdAmount,
    [LINE.GENERAL_INCOME]: generalRateIncome,
    [LINE.TAX_BEFORE_CREDITS]: taxBeforeCredits,
    [LINE.IEG]: innovationEmploymentGrant,
    [LINE.TAX_PAYABLE]: albertaTaxPayable,
  }

  return {
    taxationYear: input.taxationYear,
    albertaTaxableIncome,
    albertaSbdIncome,
    albertaSbdAmount,
    generalRateIncome,
    taxBeforeCredits,
    innovationEmploymentGrant,
    albertaTaxPayable,
    lines,
    engineVersion,
  }
}
