'use client'

import { useEffect, useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import { Card, Hero, MetricGrid } from '@/components/forecasts/ui'
import { fmtMoney } from '@/lib/forecasts/computed'

interface Projection {
  kind: 'personal' | 'corporate'
  year: number
  label: string
  province: string
  rateVersion: string
  months: string[]
  coverage: { included: number; of: number }
  income: number
  expenses: number
  taxableIncome: number
  totalTax: number
  effectiveRate: number
  monthlySetAside: number
  breakdown: { label: string; amount: number; detail?: string }[]
  notes: string[]
}

export default function TaxesClient() {
  const { data } = useForecast()
  const [year, setYear] = useState<number | null>(null)
  const [years, setYears] = useState<number[]>([])
  const [proj, setProj] = useState<Projection | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Recomputes whenever the scenario data changes (edits flow through the store).
  useEffect(() => {
    let cancelled = false
    const q = year ? `?year=${year}` : ''
    fetch(`/api/forecasts/${data.id}/taxes${q}`, { cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error((await r.json()).error || 'Could not compute taxes'); return r.json() })
      .then((j) => { if (cancelled) return; setProj(j.data); setYears(j.options.years); setError(null) })
      .catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => { cancelled = true }
  }, [data, year])

  if (error) return <p className="text-sm text-[#BF2600]">{error}</p>
  if (!proj) return <p className="text-sm text-gray-400">Computing…</p>
  const corporate = proj.kind === 'corporate'

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {years.map((y) => (
          <button key={y} type="button" onClick={() => setYear(y)} className={`rounded px-3 py-1 text-[13px] ${y === proj.year ? 'bg-[#0075DD] text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}>{corporate ? `FY${String(y).slice(-2)}` : y}</button>
        ))}
      </div>
      <Hero label={proj.label} value={fmtMoney(proj.totalTax)} badge={`${proj.effectiveRate.toFixed(1)}% effective`} badgeTone="muted"
        sub={<>{proj.months.length ? `${proj.months[0]} to ${proj.months[proj.months.length - 1]}` : 'No months of this year in the workbook'} · {proj.coverage.included} of {proj.coverage.of} months in the workbook{proj.coverage.included < proj.coverage.of ? ' (extend the workbook in Settings for a full-year estimate)' : ''}</>} />

      <MetricGrid metrics={corporate ? [
        { label: 'Revenue', value: fmtMoney(proj.income) },
        { label: 'Expenses', value: fmtMoney(proj.expenses) },
        { label: 'Net income', value: fmtMoney(proj.taxableIncome), neg: proj.taxableIncome <= 0 },
        { label: 'Tax bill', value: fmtMoney(proj.totalTax) },
        { label: 'Set aside monthly', value: fmtMoney(proj.monthlySetAside) },
      ] : [
        { label: 'Income for the year', value: fmtMoney(proj.income) },
        { label: 'Taxable income', value: fmtMoney(proj.taxableIncome) },
        { label: 'Tax bill', value: fmtMoney(proj.totalTax) },
        { label: 'Effective rate', value: `${proj.effectiveRate.toFixed(1)}%` },
        { label: 'Set aside monthly', value: fmtMoney(proj.monthlySetAside) },
      ]} />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="How it adds up">
          <table className="w-full text-sm">
            <tbody>
              {proj.breakdown.map((b, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 text-gray-800">{b.label}{b.detail && <span className="ml-2 text-[12px] text-gray-400">{b.detail}</span>}</td>
                  <td className={`py-2 text-right tabular-nums ${b.amount < 0 ? 'text-[#006644]' : 'text-gray-900'}`}>{b.amount < 0 ? `−${fmtMoney(-b.amount)}` : fmtMoney(b.amount)}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="pt-2">Total</td><td className="pt-2 text-right tabular-nums">{fmtMoney(proj.totalTax)}</td></tr>
            </tbody>
          </table>
        </Card>
        <Card title="Assumptions">
          <ul className="list-disc space-y-1.5 pl-4 text-[13px] text-gray-600">
            {proj.notes.map((n, i) => <li key={i}>{n}</li>)}
            <li>{corporate ? 'Business scenario: uses the fiscal year from Books company settings.' : 'Personal scenario: calendar year. Set owner pay accounts in Settings so draws from the business show up here.'}</li>
          </ul>
        </Card>
      </div>
    </div>
  )
}
