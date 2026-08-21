/**
 * T1 slip-box → T1-line mapping descriptors (design §1.3 tables).
 *
 * DECLARATIVE ONLY: each entry says "this slip's box `box` contributes to T1
 * line `line`". No amounts are hardcoded — the pull (pull.ts) reads the
 * effective box value off each slip and sums by target line. The eligibility
 * split (12000 vs 12010) and the federal-DTC line (40425) all fall out of these
 * declarations.
 *
 * Mappings are keyed by slip TYPE ('T5' | 'T4A' | 'T3'). For the canonical
 * dividend-only Alberta filer only T5 is present; the T4A/T3 mappings exist so
 * the pull yields nothing (rather than throwing) when those slips are absent,
 * and so an opted-in capital-gains / T3 case has a declared path.
 *
 * Box keys here are the SAME internal keys used on `TaxSlip.boxes` JSON (the
 * `key` field of each BoxDescriptor — e.g. 'box11', 'box25', 'box048'), NOT the
 * CRA officialNumber. The pull reads `effBox(boxes, override, key)`.
 *
 * Pure data/contracts only — NO I/O in this file.
 */

// ---------------------------------------------------------------------------
// Slip-box → T1-line mapping
// ---------------------------------------------------------------------------

/**
 * The slip types the T1 pull consumes. Mirrors the inline union on
 * `PulledRef.slipType` / `SlipTranscriptionCard.slipType` in types.ts.
 */
export type T1SlipType = 'T5' | 'T4A' | 'T3'

/**
 * One declarative mapping: the slip box `boxKey` (TaxSlip.boxes JSON key) flows
 * into T1 line `line`. `eligibility` tags dividend taxable/DTC boxes so the
 * pull can derive the 12000 (all) vs 12010 (non-eligible subset) split and route
 * the federal DTC to 40425 without hardcoding which box is which.
 */
export interface T1SlipLineMap {
  /** internal box key on TaxSlip.boxes JSON (e.g. 'box11', 'box25', 'box048'). */
  boxKey: string
  /** CRA box number printed on the slip (for the transcription card label). */
  officialNumber: string
  /** human label for the transcription card. */
  label: string
  /** target T1 line number (string). */
  line: string
  /**
   * Role of this box in the dividend split, when applicable:
   *  - 'taxableEligible'    → contributes to 12000 only
   *  - 'taxableNonEligible' → contributes to BOTH 12000 and 12010
   *  - 'federalDtc'         → contributes to 40425 (federal dividend tax credit)
   *  - 'actual'             → actual-amount box, transcription only (no T1 line sum)
   * Omitted for non-dividend boxes (interest, fees, etc.).
   */
  role?: 'taxableEligible' | 'taxableNonEligible' | 'federalDtc' | 'actual'
  /**
   * When true this box only matters if its opt-in section is enabled (e.g.
   * capital gains → Schedule 3 → 12700). Default-hidden for the base persona.
   */
  optIn?: boolean
}

/**
 * The slip→line mapping per slip type. Derivations (design §1.3):
 *   12010 = Σ box11 (+ T3 box23)                          [taxableNonEligible]
 *   12000 = Σ (box11 + box25) (+ T3 box23 + box49)        [taxable* both kinds]
 *   40425 = Σ (box12 + box26) (+ T3 box39 + box51)        [federalDtc]
 *
 * The 'actual' boxes (T5 box10/box24, T3 actuals) are carried for the
 * transcription card only — they are NOT summed into a T1 line (the taxable
 * grossed-up amounts are what the return uses).
 */
export const T1_SLIP_MAPS: Record<T1SlipType, T1SlipLineMap[]> = {
  T5: [
    // Non-eligible (other than eligible) dividends
    { boxKey: 'box10', officialNumber: '10', label: 'Actual amount of dividends other than eligible dividends', line: '12010', role: 'actual' },
    { boxKey: 'box11', officialNumber: '11', label: 'Taxable amount of dividends other than eligible dividends', line: '12010', role: 'taxableNonEligible' },
    { boxKey: 'box12', officialNumber: '12', label: 'Dividend tax credit for dividends other than eligible dividends', line: '40425', role: 'federalDtc' },
    // Eligible dividends
    { boxKey: 'box24', officialNumber: '24', label: 'Actual amount of eligible dividends', line: '12000', role: 'actual' },
    { boxKey: 'box25', officialNumber: '25', label: 'Taxable amount of eligible dividends', line: '12000', role: 'taxableEligible' },
    { boxKey: 'box26', officialNumber: '26', label: 'Dividend tax credit for eligible dividends', line: '40425', role: 'federalDtc' },
  ],
  T4A: [
    // Fees for services — self-employment path; carried as a transcription box.
    { boxKey: 'box048', officialNumber: '048', label: 'Fees for services', line: '13500', optIn: true },
  ],
  T3: [
    // Eligible / non-eligible dividends from a trust (mirror the T5 split).
    { boxKey: 'box49', officialNumber: '49', label: 'Actual amount of eligible dividends', line: '12000', role: 'actual', optIn: true },
    { boxKey: 'box50', officialNumber: '50', label: 'Taxable amount of eligible dividends', line: '12000', role: 'taxableEligible', optIn: true },
    { boxKey: 'box51', officialNumber: '51', label: 'Dividend tax credit (eligible)', line: '40425', role: 'federalDtc', optIn: true },
    { boxKey: 'box23', officialNumber: '23', label: 'Actual amount of dividends other than eligible dividends', line: '12010', role: 'actual', optIn: true },
    { boxKey: 'box32', officialNumber: '32', label: 'Taxable amount of dividends other than eligible dividends', line: '12010', role: 'taxableNonEligible', optIn: true },
    { boxKey: 'box39', officialNumber: '39', label: 'Dividend tax credit (non-eligible)', line: '40425', role: 'federalDtc', optIn: true },
    // Capital gains → Schedule 3 → 12700 (opt-in only).
    { boxKey: 'box21', officialNumber: '21', label: 'Capital gains', line: '12700', optIn: true },
  ],
}

/** All slip types the T1 pull knows how to consume. */
export const T1_SLIP_TYPES: readonly T1SlipType[] = ['T5', 'T4A', 'T3']

/** Look up the declarative mapping for a slip type ([] if unmapped). */
export function slipLineMapsFor(type: T1SlipType): T1SlipLineMap[] {
  return T1_SLIP_MAPS[type] ?? []
}
