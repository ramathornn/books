'use client'

import { money2 } from '@/lib/tax/round'

/**
 * Auto-pull box field, shared by the slip form-builder (T5/T4A).
 *
 * Shows the GL-computed amount for a box (read-only), with an optional per-field
 * OVERRIDE input. When an override diverges from the computed value, a drift note
 * is surfaced (design finding #14 / §3 drift banner). The effective value the
 * slip will store is `override ?? computed`.
 */
export default function AutoPullField({
  officialNumber,
  label,
  computed,
  override,
  onOverrideChange,
  readOnly = false,
}: {
  officialNumber: string
  label: string
  computed: number | undefined
  /** the per-field override string ('' = no override). */
  override: string
  onOverrideChange: (v: string) => void
  readOnly?: boolean
}) {
  const overrideNum = override.trim() === '' ? undefined : Number(override)
  const hasOverride = overrideNum !== undefined && Number.isFinite(overrideNum)
  const drift =
    hasOverride && computed !== undefined && Math.abs((overrideNum as number) - computed) > 0.005

  return (
    <div className="grid grid-cols-[3rem_1fr_8rem] items-start gap-3 py-2 border-b border-[#F1F4F8] last:border-0">
      <div className="font-mono text-sm text-[#001B40] pt-2">{officialNumber}</div>
      <div className="pt-2">
        <div className="text-sm text-[#001B40]">{label}</div>
        <div className="text-xs text-[#8595A8]">
          Auto-pulled: {computed !== undefined ? money2(computed) : '—'}
        </div>
        {drift ? (
          <div className="text-xs text-[#9B2C2C] mt-0.5">
            Override differs from auto-pull by {money2((overrideNum as number) - (computed ?? 0))}.
          </div>
        ) : null}
      </div>
      <div>
        <input
          value={override}
          inputMode="decimal"
          readOnly={readOnly}
          onChange={(e) => onOverrideChange(e.target.value)}
          placeholder={computed !== undefined ? money2(computed) : '0.00'}
          className={`w-full rounded-md border px-2 py-1.5 text-sm text-right font-mono ${
            drift ? 'border-[#E0A23C] bg-[#FFF8E8]' : 'border-[#D9E1EC]'
          } ${readOnly ? 'bg-[#F4F7FB] text-[#8595A8]' : ''}`}
        />
      </div>
    </div>
  )
}
