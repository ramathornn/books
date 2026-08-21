'use client'

import { useState } from 'react'

import { money2 } from '@/lib/tax/round'
import type { T1LineDescriptor, T1Lines, PulledRefs } from '@/lib/tax/t1/types'
import LineField from './LineField'

/**
 * Collapsible sectioned card of T1 lines — the line-keyed analogue of
 * SlipFormBuilder. One card per T1 section (Income, Deductions, …); each renders
 * its descriptors as LineFields. Pulled values come from `pulled`/`computed`;
 * manual entries are owned by the parent via `overrides` + `onOverrideChange`.
 *
 * Opt-in lines (capital gains / donations / medical) are hidden unless the
 * section's opt-in toggle is enabled, keeping the base dividend-only persona's
 * form clean.
 */
export default function ReturnFormBuilder({
  title,
  subtitle,
  descriptors,
  computed,
  overrides,
  pulledRefs,
  driftLines,
  onOverrideChange,
  readOnly = false,
  defaultOpen = true,
  optInLabel,
  subtotal,
}: {
  title: string
  subtitle?: string
  descriptors: T1LineDescriptor[]
  /** the effective/computed value per line (from the live computeT1 result). */
  computed: T1Lines
  /** manual override input strings per line. */
  overrides: Record<string, string>
  pulledRefs?: PulledRefs | null
  /** set of lines flagged stale by the last recompute. */
  driftLines?: Set<string>
  onOverrideChange: (line: string, value: string) => void
  readOnly?: boolean
  defaultOpen?: boolean
  /** when set, the opt-in lines in this section are gated behind a toggle. */
  optInLabel?: string
  /** optional running subtotal shown in the card header. */
  subtotal?: number
}) {
  const [open, setOpen] = useState(defaultOpen)
  const hasOptIn = descriptors.some((d) => d.optIn)
  const [showOptIn, setShowOptIn] = useState(false)

  const visible = descriptors.filter((d) => !d.optIn || showOptIn)

  return (
    <div className="rounded-lg border border-[#E5EAF1] bg-white">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <div className="text-[#001B40] font-medium">{title}</div>
          {subtitle ? <div className="text-xs text-[#8595A8] mt-0.5">{subtitle}</div> : null}
        </div>
        <div className="flex items-center gap-3">
          {subtotal !== undefined ? (
            <span className="text-sm font-mono text-[#001B40]">{money2(subtotal)}</span>
          ) : null}
          <svg
            className={`w-4 h-4 text-[#8595A8] transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open ? (
        <div className="px-4 pb-3">
          {hasOptIn && optInLabel ? (
            <label className="flex items-center gap-2 py-2 text-sm text-[#576981] border-b border-[#F1F4F8]">
              <input
                type="checkbox"
                checked={showOptIn}
                onChange={(e) => setShowOptIn(e.target.checked)}
                disabled={readOnly}
              />
              {optInLabel}
            </label>
          ) : null}

          {visible.map((d) => {
            const ref = pulledRefs?.[d.line]
            const provenance = ref
              ? `${ref.slipType}${ref.slipNumbers.length ? ` #${ref.slipNumbers.join(', #')}` : ''}`
              : null
            return (
              <LineField
                key={d.line}
                line={d.line}
                label={d.label}
                source={d.source}
                value={computed[d.line]}
                help={d.help}
                provenance={provenance}
                drift={driftLines?.has(d.line)}
                manualValue={overrides[d.line]}
                onManualChange={(v) => onOverrideChange(d.line, v)}
                readOnly={readOnly}
              />
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
