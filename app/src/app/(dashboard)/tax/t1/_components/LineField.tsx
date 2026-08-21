'use client'

import { money2 } from '@/lib/tax/round'
import type { LineSource } from '@/lib/tax/t1/types'

/**
 * One T1 line row in the ReturnFormBuilder — the line-keyed analogue of
 * AutoPullField. Three flavours by `source`:
 *
 *  - 'pull'     → auto-pulled from the filer's slips (read-only) with a
 *                 provenance note ("Auto-pulled from T5 #…") and a DRIFT banner
 *                 when the pulled slip was amended after the line was pulled.
 *  - 'manual'   → a user input (RRSP from the NOA, instalments, etc.).
 *  - 'computed' → a derived total/tax/refund (read-only), recomputed live by the
 *                 builder's client-side computeT1.
 */
export default function LineField({
  line,
  label,
  source,
  value,
  help,
  provenance,
  drift,
  manualValue,
  onManualChange,
  readOnly = false,
}: {
  line: string
  label: string
  source: LineSource
  /** the effective (computed/pulled) value to display. */
  value: number | undefined
  help?: string
  /** provenance note for a pulled line, e.g. "T5 #000123". */
  provenance?: string | null
  /** true when this pulled line is stale vs the slip's current amendmentSeq. */
  drift?: boolean
  /** current manual input string (only for source==='manual'). */
  manualValue?: string
  onManualChange?: (v: string) => void
  readOnly?: boolean
}) {
  const computedLine = source === 'computed'
  const pulledLine = source === 'pull'

  return (
    <div
      className={`grid grid-cols-[3.5rem_1fr_9rem] items-start gap-3 py-2.5 border-b border-[#F1F4F8] last:border-0 ${
        computedLine ? 'bg-[#FBFCFE]' : ''
      }`}
    >
      <div className="font-mono text-sm text-[#001B40] pt-2">{line}</div>
      <div className="pt-2">
        <div className="text-sm text-[#001B40]">{label}</div>
        {pulledLine && provenance ? (
          <div className="text-xs text-[#8595A8]">Auto-pulled from {provenance}</div>
        ) : null}
        {help ? <div className="text-xs text-[#8595A8] mt-0.5">{help}</div> : null}
        {drift ? (
          <div className="text-xs text-[#9B2C2C] mt-0.5">
            This slip was amended after the line was pulled — recompute to refresh.
          </div>
        ) : null}
      </div>
      <div className="pt-1">
        {source === 'manual' && !readOnly ? (
          <input
            value={manualValue ?? ''}
            inputMode="decimal"
            onChange={(e) => onManualChange?.(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-md border border-[#D9E1EC] px-2 py-1.5 text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30"
          />
        ) : (
          <div
            className={`px-2 py-1.5 text-sm text-right font-mono rounded-md ${
              computedLine ? 'text-[#001B40] font-medium' : 'text-[#576981]'
            } ${drift ? 'bg-[#FFF1F1]' : ''}`}
          >
            {value !== undefined ? money2(value) : '—'}
          </div>
        )}
      </div>
    </div>
  )
}
