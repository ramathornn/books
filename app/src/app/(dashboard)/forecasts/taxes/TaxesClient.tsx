'use client'

import { useEffect, useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import { Card, Hero, MetricGrid } from '@/components/forecasts/ui'
import TaxWhatIf from '@/components/forecasts/TaxWhatIf'
import TaxTiers from '@/components/forecasts/TaxTiers'
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
  tiers: { jurisdiction: string; rate: number; from: number; to: number; amount: number; tax: number }[]
  notes: string[]
  overrides?: { field: string; value: number; note?: string | null; updatedAt?: string }[]
}

const OVERRIDE_LABELS: Record<string, string> = {
  income: 'Income',
  incomeAdjustment: 'Income adjustment',
  expenses: 'Expenses',
  expenseAdjustment: 'Expenses adjustment',
  totalTax: 'Total tax',
}

export default function TaxesClient() {
  const { data, showTable, showCharts } = useForecast()
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
      <Hero label={proj.label} value={fmtMoney(proj.totalTax)} badge={proj.overrides?.length ? 'Manually adjusted' : `${proj.effectiveRate.toFixed(1)}% effective`} badgeTone="muted" asOf={false}
        sub={<>{proj.months.length ? `${proj.months[0]} to ${proj.months[proj.months.length - 1]}` : 'No months of this year in the workbook'} · {proj.coverage.included} of {proj.coverage.of} months in the workbook{proj.coverage.included < proj.coverage.of ? ' (extend the workbook in Settings for a full-year estimate)' : ''}</>} />

      {!!proj.overrides?.length && (
        <div className="mb-4 rounded-lg border border-[#FFC400] bg-[#FFFAE6] px-4 py-3">
          <p className="mb-1 text-[13px] font-medium text-[#7A5B00]">Manual overrides applied to this year</p>
          <ul className="space-y-0.5 text-[12px] text-[#7A5B00]">
            {proj.overrides.map((o) => (
              <li key={o.field}>
                {OVERRIDE_LABELS[o.field] ?? o.field}: <span className="tabular-nums font-medium">{fmtMoney(o.value)}</span>
                {o.note ? ` — ${o.note}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-[#7A5B00]/70">Set over the API; the figures above already include them.</p>
        </div>
      )}

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
      <TaxWhatIf year={proj.year} province={proj.province} projectedTax={proj.totalTax} />


{showCharts && (
      <Card title="Tax by bracket" className="mb-4">
        <TaxTiers tiers={proj.tiers} />
      </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
{showTable && (
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
        )}
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
