'use client'

import AutoPullField from './AutoPullField'

/**
 * Descriptor-driven slip box form-builder, shared by T5 and T4A (and any future
 * slip type). Renders one AutoPullField per box from the type descriptor, wiring
 * the auto-pulled (GL-computed) value and the per-field override. The effective
 * value the slip stores is `override ?? computed` (computed via `effectiveBoxes`).
 *
 * It is intentionally pure UI: the parent owns the compute call, the recipient,
 * and the save. This keeps the builder reusable across the new/edit flows.
 */

export interface BoxDescriptorLite {
  key: string
  officialNumber: string
  label: string
}

export interface SlipFormState {
  /** GL-auto-pulled amounts keyed by box key. */
  computed: Record<string, number>
  /** per-field override strings keyed by box key ('' = no override). */
  overrides: Record<string, string>
}

/** Effective box values: numeric override wins, else the computed amount. */
export function effectiveBoxes(state: SlipFormState, boxes: BoxDescriptorLite[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of boxes) {
    const ov = state.overrides[b.key]
    if (ov !== undefined && ov.trim() !== '') {
      const n = Number(ov)
      if (Number.isFinite(n)) {
        out[b.key] = n
        continue
      }
    }
    if (state.computed[b.key] !== undefined) out[b.key] = state.computed[b.key]
  }
  return out
}

export default function SlipFormBuilder({
  boxes,
  state,
  onOverrideChange,
  readOnly = false,
}: {
  boxes: BoxDescriptorLite[]
  state: SlipFormState
  onOverrideChange: (key: string, value: string) => void
  readOnly?: boolean
}) {
  return (
    <div className="rounded-lg border border-[#D9E1EC] bg-white px-4">
      <div className="grid grid-cols-[3rem_1fr_8rem] gap-3 py-2 border-b border-[#D9E1EC] text-xs font-medium text-[#576981]">
        <div>Box</div>
        <div>Amount</div>
        <div className="text-right">Override</div>
      </div>
      {boxes.map((b) => (
        <AutoPullField
          key={b.key}
          officialNumber={b.officialNumber}
          label={b.label}
          computed={state.computed[b.key]}
          override={state.overrides[b.key] ?? ''}
          onOverrideChange={(v) => onOverrideChange(b.key, v)}
          readOnly={readOnly}
        />
      ))}
    </div>
  )
}
