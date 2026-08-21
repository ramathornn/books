import { computeT4A, computeT4ABoxes } from '@/lib/tax/compute/t4a'
import { round2 } from '@/lib/tax/round'
import type { BoxDescriptor } from '@/lib/tax/descriptors/t5'

/**
 * T4A slip descriptor. Mirrors the T5 descriptor contract (box key ↔ official
 * number ↔ XML element ↔ AcroForm field ↔ validation ↔ computeBoxes).
 *
 * Only Box 048 (fees for services) is in scope for the locked subcontractor
 * case; other boxes can be added to this array without touching the routes.
 * AcroField names are placeholders pending the official CRA fillable T4A PDF.
 */

const nonNegative = (label: string) => (v: number) =>
  v < 0 ? `${label} must not be negative` : null

export const T4A_BOXES: BoxDescriptor[] = [
  {
    key: 'box048',
    officialNumber: '048',
    xmlElement: 'FEES_SRVCS_AMT',
    acroField: 'Box048_FeesForServices',
    label: 'Fees for services',
    validate: nonNegative('Box 048'),
  },
]

export const T4A_DESCRIPTOR = {
  type: 'T4A' as const,
  boxes: T4A_BOXES,
  /** pure compute reference (fees total → box shape). */
  computeBoxes: computeT4ABoxes,
  /** DB-backed compute (Expense + Bill line pull). */
  compute: computeT4A,
  round: round2,
}

export type T4ADescriptor = typeof T4A_DESCRIPTOR
