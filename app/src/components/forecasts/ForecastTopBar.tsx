'use client'

// Scenario switcher + visible-range presets (Current, trailing, forward,
// fiscal years). Fiscal years follow the company's fiscal year-end from Books
// settings instead of WealthPilot's hard-coded Sep–Aug.

import { useEffect } from 'react'
import { useForecast } from './ForecastProvider'
import DateRangePicker from './DateRangePicker'
import { currentMonthIndex, monthLabel, monthTargetIndex } from '@/lib/forecasts/months'

export default function ForecastTopBar({ fiscalYearEndMonth }: { fiscalYearEndMonth: number }) {
  const { data, scenarios, setViewRange, switchScenario, saving, readOnly } = useForecast()
  const ml = data.months.length
  const nowIdx = currentMonthIndex(data.months)
  const vf = data.viewFrom, vt = data.viewTo

  const range = (from: number, to: number) => setViewRange(Math.max(0, from), Math.max(0, to))

  // Fiscal years: FY N ends in fiscalYearEndMonth (1-12) of year N.
  const fyStartMonth = fiscalYearEndMonth % 12 // 0-11; Dec YE → Jan start
  const now = new Date()
  const currentFy = now.getMonth() + 1 > fiscalYearEndMonth ? now.getFullYear() + 1 : now.getFullYear()
  const fyBounds = (fy: number) => {
    const startYear = fyStartMonth === 0 ? fy : fy - 1
    const s = monthTargetIndex(data.months, monthLabel(startYear, fyStartMonth))
    const e = monthTargetIndex(data.months, monthLabel(fy, fiscalYearEndMonth - 1))
    return { s, e }
  }
  const fys = [currentFy - 1, currentFy, currentFy + 1]

  // Default to the forward-6 view when the workbook still shows everything.
  useEffect(() => {
    if (vf === 0 && vt === ml - 1 && ml > 6 && !readOnly) range(nowIdx, nowIdx + 5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id])

  const presets: { label: string; from: number; to: number; title: string }[] = [
    { label: 'Current', from: nowIdx, to: nowIdx, title: 'This month' },
    { label: 'T6', from: nowIdx - 5, to: nowIdx, title: 'Trailing 6 months' },
    { label: 'T12', from: nowIdx - 11, to: nowIdx, title: 'Trailing 12 months' },
    { label: 'T24', from: nowIdx - 23, to: nowIdx, title: 'Trailing 24 months' },
    { label: 'F6', from: nowIdx, to: nowIdx + 5, title: 'Next 6 months' },
    { label: 'F12', from: nowIdx, to: nowIdx + 11, title: 'Next 12 months' },
    { label: 'F24', from: nowIdx, to: nowIdx + 23, title: 'Next 24 months' },
    ...fys.map((fy) => { const { s, e } = fyBounds(fy); return { label: `FY${String(fy).slice(-2)}`, from: s, to: e, title: `Fiscal year ${fy}` } }).filter((p) => p.from >= 0 && p.to >= 0),
  ]
  const btn = (active: boolean) => `h-8 rounded px-2.5 text-[12px] font-medium ${active ? 'bg-[#0075DD] text-white' : 'text-gray-600 hover:bg-gray-100'}`

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex rounded border border-gray-300 bg-white p-0.5" role="tablist" aria-label="Scenario">
        {scenarios.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === data.id} onClick={() => switchScenario(s.id)} className={`rounded px-3 py-1 text-[13px] ${s.id === data.id ? 'bg-[#002D79] font-semibold text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
            {s.name}
          </button>
        ))}
      </div>
      <DateRangePicker months={data.months} viewFrom={vf} viewTo={vt} onChange={range} />
      <div className="flex flex-wrap items-center gap-0.5 rounded border border-gray-200 bg-white p-0.5">
        {presets.map((p, i) => (
          <span key={p.label} className="flex items-center">
            {(i === 1 || i === 4 || i === 7) && <span className="mx-0.5 h-5 w-px bg-gray-200" />}
            <button type="button" title={p.title} onClick={() => range(p.from, p.to)} className={btn(vf === Math.max(0, p.from) && vt === p.to)}>{p.label}</button>
          </span>
        ))}
      </div>
      <span className="ml-auto text-[12px] text-gray-400">{saving ? 'Saving…' : readOnly ? 'Read-only' : 'All changes saved'}</span>
    </div>
  )
}
