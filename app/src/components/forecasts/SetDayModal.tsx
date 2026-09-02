'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import type { FlowDayValue } from '@/lib/forecasts/types'
import { daysInMonth, dayLabel } from '@/lib/forecasts/flowDays'

interface Props {
  open: boolean
  row: string | undefined
  monthLabel: string | undefined
  currentDay: FlowDayValue | null | undefined
  hasDay: boolean | undefined
  onSave: (day: FlowDayValue, scope: 'month' | 'onward') => void
  onClear: () => void
  onClose: () => void
}

/** Pick the day-of-month a cell lands on, for this month only or from here onward. */
export default function SetDayModal({ open, row, monthLabel, currentDay, hasDay, onSave, onClear, onClose }: Props) {
  // Mounted fresh each time it opens (see EditableTable), so props seed state directly.
  const [day, setDay] = useState<FlowDayValue>(currentDay ?? 'last')
  const [scope, setScope] = useState<'month' | 'onward'>('onward')
  const dim = daysInMonth(monthLabel ?? null)

  return (
    <Modal isOpen={open} onClose={onClose} title={`Set day — ${row ?? ''}`}>
      <p className="mb-3 text-sm text-gray-600">
        Which day of <span className="font-medium">{monthLabel}</span> does this amount land on? Currently: <span className="font-medium">{dayLabel(currentDay ?? null)}{hasDay ? '' : ' (default)'}</span>.
      </p>
      <div className="mb-3 grid grid-cols-7 gap-1">
        {Array.from({ length: dim }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDay(d)}
            className={`rounded px-0 py-1.5 text-[12px] ${day === d ? 'bg-[#0075DD] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setDay('last')}
          className={`col-span-7 rounded px-2 py-1.5 text-[12px] ${day === 'last' ? 'bg-[#0075DD] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
        >
          Last day of month
        </button>
      </div>
      <div className="mb-4 flex gap-2 text-sm">
        {(['onward', 'month'] as const).map((s) => (
          <label key={s} className={`flex flex-1 cursor-pointer items-center gap-2 rounded border px-3 py-2 ${scope === s ? 'border-[#0075DD] bg-[#DEEBFF]' : 'border-gray-200'}`}>
            <input type="radio" name="scope" checked={scope === s} onChange={() => setScope(s)} />
            <span>{s === 'onward' ? 'From this month onward' : 'This month only'}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between">
        {hasDay ? (
          <button type="button" onClick={() => { onClear(); onClose() }} className="text-sm text-[#DE350B] hover:underline">Clear day</button>
        ) : <span />}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" onClick={() => onSave(day, scope)} className="rounded bg-[#038A06] px-4 py-2 text-sm font-medium text-white hover:bg-[#026e05]">Save</button>
        </div>
      </div>
    </Modal>
  )
}
