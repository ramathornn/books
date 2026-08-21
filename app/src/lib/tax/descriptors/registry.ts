import { T5_DESCRIPTOR } from '@/lib/tax/descriptors/t5'
import { T4A_DESCRIPTOR } from '@/lib/tax/descriptors/t4a'
import type { BoxDescriptor } from '@/lib/tax/descriptors/t5'

/**
 * Slip-type registry: the single lookup that lets the generic, descriptor-driven
 * slip framework (the `/api/tax/[slipType]/*` routes and the `tax/_shared` UI)
 * serve every slip type without per-type route code. A new info-return slip is
 * added by writing its descriptor + compute fn and registering it here.
 *
 * Each descriptor carries, per box: key ↔ official CRA number ↔ XML element ↔
 * AcroForm field ↔ validation, plus the pure `computeBoxes` and the DB-backed
 * `compute` adapter (see descriptors/{t5,t4a}.ts).
 */

export type SlipType = 'T5' | 'T4A'

interface SlipDescriptorLike {
  type: SlipType
  boxes: BoxDescriptor[]
  computeBoxes: (...args: never[]) => Record<string, number>
  round: (x: number) => number
}

const REGISTRY: Record<SlipType, SlipDescriptorLike> = {
  T5: T5_DESCRIPTOR as unknown as SlipDescriptorLike,
  T4A: T4A_DESCRIPTOR as unknown as SlipDescriptorLike,
}

/** Map a URL slug ("t4a") to a canonical slip type ("T4A"); null if unknown. */
export function slipTypeFromSlug(slug: string): SlipType | null {
  const upper = (slug || '').toUpperCase()
  if (upper === 'T5' || upper === 'T4A') return upper
  return null
}

/** Look up a descriptor by canonical type. Throws on an unknown type. */
export function descriptorFor(type: SlipType): SlipDescriptorLike {
  const d = REGISTRY[type]
  if (!d) throw new Error(`No slip descriptor registered for type "${type}"`)
  return d
}

/** Box descriptors for a type (used by Summary/PDF/UI rendering). */
export function boxesFor(type: SlipType): BoxDescriptor[] {
  return descriptorFor(type).boxes
}
