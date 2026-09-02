'use client'

import { useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import { Card } from '@/components/forecasts/ui'
import { resolveValue } from '@/lib/forecasts/formula'
import { convertToCAD } from '@/lib/forecasts/currency'
import { toast } from '@/lib/toast'

// Scenario-level settings: name, FX overrides, workbook length, and exports.
// AI advisor, data-path, and API-key settings from WealthPilot are intentionally
// absent: Books owns storage and auth.
export default function SettingsClient() {
  const { data, rates, renameScenario, setRateOverride, extendMonths, readOnly } = useForecast()
  const [name, setName] = useState(data.name)
  const [usd, setUsd] = useState(data.rateOverrides.USD ? String(data.rateOverrides.USD) : '')
  const [eur, setEur] = useState(data.rateOverrides.EUR ? String(data.rateOverrides.EUR) : '')
  const [months, setMonths] = useState(String(data.months.length))
  const input = 'h-9 rounded border border-gray-300 px-2 text-sm focus:border-[#0075DD] focus:outline-none disabled:bg-gray-50'
  const btn = 'h-9 rounded border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'

  const download = (filename: string, content: string, type: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type }))
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const stamp = new Date().toISOString().slice(0, 10)
  const exportJson = () => { const { ids: _ids, ...rest } = data; void _ids; download(`forecast-${data.name.toLowerCase()}-${stamp}.json`, JSON.stringify(rest, null, 2), 'application/json') }
  const exportCsv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`
    const lines = [['Section', 'Row', 'Currency', ...data.months].map(esc).join(',')]
    const push = (section: string, rows: Record<string, (number | string)[] | null>, cur?: Record<string, string>) => {
      for (const [k, arr] of Object.entries(rows)) {
        if (!arr || k.startsWith('_')) continue
        const vals = arr.map((v, i) => { const n = resolveValue(v, data, i); return section === 'income' ? convertToCAD(n, cur?.[k] || 'CAD', rates) : n })
        lines.push([esc(section), esc(k), esc(cur?.[k] || 'CAD'), ...vals.map((v) => String(Math.round(v * 100) / 100))].join(','))
      }
    }
    push('income', data.income, data.incomeCurrencies); push('expenses', data.expenses); push('debts', data.receivables)
    download(`forecast-${data.name.toLowerCase()}-${stamp}.csv`, lines.join('\n'), 'text/csv')
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card title="Scenario">
        <div className="flex items-end gap-2">
          <label className="text-sm text-gray-600">Name<br /><input value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} className={`${input} mt-1 w-64`} /></label>
          <button type="button" className={btn} disabled={readOnly || !name.trim() || name.trim() === data.name} onClick={() => { renameScenario(name.trim()); toast.success('Scenario renamed') }}>Save</button>
        </div>
        <p className="mt-2 text-[12px] text-gray-500">Workbook runs {data.months[0]} to {data.months[data.months.length - 1]} ({data.months.length} months).</p>
        <div className="mt-2 flex items-end gap-2">
          <label className="text-sm text-gray-600">Months<br /><input type="number" min={data.months.length} max={240} value={months} disabled={readOnly} onChange={(e) => setMonths(e.target.value)} className={`${input} mt-1 w-28`} /></label>
          <button type="button" className={btn} disabled={readOnly || !(parseInt(months, 10) > data.months.length)} onClick={() => { extendMonths(parseInt(months, 10)); toast.success('Workbook extended') }}>Extend</button>
        </div>
      </Card>

      <Card title="Exchange rates">
        <p className="mb-3 text-[12px] text-gray-500">Live rates come from Books&apos; Bank of Canada feed (USD {rates.USD.toFixed(4)}, EUR {rates.EUR.toFixed(4)} CAD per unit). Set an override to plan against a fixed rate; clear it to follow Books again.</p>
        <div className="flex flex-wrap items-end gap-2">
          {([['USD', usd, setUsd], ['EUR', eur, setEur]] as const).map(([ccy, val, set]) => (
            <div key={ccy} className="flex items-end gap-1">
              <label className="text-sm text-gray-600">{ccy} override<br /><input type="number" step="0.0001" value={val} disabled={readOnly} placeholder="follow Books" onChange={(e) => set(e.target.value)} className={`${input} mt-1 w-36`} /></label>
              <button type="button" className={btn} disabled={readOnly} onClick={() => { const n = parseFloat(val); setRateOverride(ccy, Number.isFinite(n) && n > 0 ? n : null); toast.success(Number.isFinite(n) && n > 0 ? `${ccy} fixed at ${n}` : `${ccy} follows Books`) }}>Apply</button>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Export">
        <div className="flex gap-2">
          <button type="button" className={btn} onClick={exportCsv}>Download CSV</button>
          <button type="button" className={btn} onClick={exportJson}>Download JSON</button>
        </div>
        <p className="mt-2 text-[12px] text-gray-500">CSV resolves formulas and converts income to CAD. JSON is the raw scenario, formulas included.</p>
      </Card>
    </div>
  )
}
