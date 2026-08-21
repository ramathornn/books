import { computeT5, computeT5Boxes } from '@/lib/tax/compute/t5'
import { round2 } from '@/lib/tax/round'

/**
 * T5 slip descriptor: the single contract that ties together, per box —
 *  - `key`           internal box key used on TaxSlip.boxes JSON
 *  - `officialNumber` CRA box number printed on the slip
 *  - `xmlElement`     element name in the CRA T5 XML schema
 *  - `acroField`      AcroForm field name in CRA's fillable T5 PDF (pdf-lib)
 *  - `label`          human label
 *  - `validate`       per-box validation
 *
 * The AcroForm field names are placeholders pending the official CRA fillable
 * PDF (design §6 Q7 / Phase 0 step 3); `fillCraSlip` degrades gracefully when
 * the template is absent. XML element names follow the CRA T5 slip XSD naming
 * convention (T5 amounts are reported as cents-free dollar amounts).
 */

export interface BoxDescriptor {
  key: string
  officialNumber: string
  xmlElement: string
  acroField: string
  label: string
  validate?: (value: number) => string | null
}

const nonNegative = (label: string) => (v: number) =>
  v < 0 ? `${label} must not be negative` : null

export const T5_BOXES: BoxDescriptor[] = [
  // Non-eligible (other than eligible) dividends
  { key: 'box10', officialNumber: '10', xmlElement: 'ACTL_AMT_NON_ELG_DIV', acroField: 'Box10_ActualNonEligible', label: 'Actual amount of dividends other than eligible dividends', validate: nonNegative('Box 10') },
  { key: 'box11', officialNumber: '11', xmlElement: 'TXBL_AMT_NON_ELG_DIV', acroField: 'Box11_TaxableNonEligible', label: 'Taxable amount of dividends other than eligible dividends', validate: nonNegative('Box 11') },
  { key: 'box12', officialNumber: '12', xmlElement: 'DIV_TX_CR_NON_ELG_DIV', acroField: 'Box12_DTCNonEligible', label: 'Dividend tax credit for dividends other than eligible dividends', validate: nonNegative('Box 12') },
  // Eligible dividends
  { key: 'box24', officialNumber: '24', xmlElement: 'ACTL_AMT_ELG_DIV', acroField: 'Box24_ActualEligible', label: 'Actual amount of eligible dividends', validate: nonNegative('Box 24') },
  { key: 'box25', officialNumber: '25', xmlElement: 'TXBL_AMT_ELG_DIV', acroField: 'Box25_TaxableEligible', label: 'Taxable amount of eligible dividends', validate: nonNegative('Box 25') },
  { key: 'box26', officialNumber: '26', xmlElement: 'DIV_TX_CR_ELG_DIV', acroField: 'Box26_DTCEligible', label: 'Dividend tax credit for eligible dividends', validate: nonNegative('Box 26') },
]

export const T5_DESCRIPTOR = {
  type: 'T5' as const,
  boxes: T5_BOXES,
  /** pure compute reference for the descriptor (and unit tests). */
  computeBoxes: computeT5Boxes,
  /** DB-backed compute (GL pull). */
  compute: computeT5,
  /** rounding rule for intra-slip arithmetic checks. */
  round: round2,
}

export type T5Descriptor = typeof T5_DESCRIPTOR
