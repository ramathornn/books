'use client'

// "What if I earned this instead" calculator on the Taxes page. Lines are typed
// in by hand, the maths runs client-side against the app's own T1/T2 tables,
// and each scenario is saved server-side so it survives a reload (and an agent
// can create or read them over /api/forecasts/{id}/tax-scenarios).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useForecast } from './ForecastProvider'
import { AddButton, Card, iconBtnDanger, TrashIcon } from './ui'
import { fmtMoney } from '@/lib/forecasts/computed'
import {
  BUSINESS_LINE_TYPES, LINE_META, PERSONAL_LINE_TYPES, computeWhatIf,
  type WhatIfLine, type WhatIfLineType,
} from '@/lib/forecasts/taxMath'
import { toast } from '@/lib/toast'

interface WhatIf { id: string; year: number; name: string; lines: WhatIfLine[] }

export default function TaxWhatIf({ year, province, projectedTax }: { year: number; province: string; projectedTax: number }) {
  const { data, readOnly } = useForecast()
  const business = data.kind === 'business'
  const types = business ? BUSINESS_LINE_TYPES : PERSONAL_LINE_TYPES
  const [items, setItems] = useState<WhatIf[]>([])
  const [loading, setLoading] = useState(true)
  const base = `/api/forecasts/${data.id}/tax-scenarios`

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`${base}?year=${year}`, { cache: 'no-store' })
        if (res.ok && !cancelled) setItems((await res.json()).scenarios as WhatIf[])
      } catch { /* leave the list empty */ } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [base, year])

  // Saves are debounced per scenario so typing does not hammer the API.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const save = useCallback((it: WhatIf) => {
    clearTimeout(timers.current[it.id])
    timers.current[it.id] = setTimeout(() => {
      void fetch(`${base}/${it.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: it.year, name: it.name, lines: it.lines }),
      }).catch(() => toast.error('Could not save the what-if'))
    }, 600)
  }, [base])

  const patch = (id: string, fn: (it: WhatIf) => WhatIf) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it
      const next = fn(it)
      save(next)
      return next
    }))
  }

  const add = async () => {
    const seed: WhatIfLine[] = business
      ? [{ type: 'revenue', label: '', amount: 0 }, { type: 'expense', label: '', amount: 0 }]
      : [{ type: 'employment', label: '', amount: 0 }]
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, name: `What if ${year}`, lines: seed }),
      })
      if (!res.ok) throw new Error('failed')
      const created = (await res.json()) as WhatIf
      setItems((prev) => [...prev, created])
    } catch { toast.error('Could not create the scenario') }
  }

  const remove = async (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    try { await fetch(`${base}/${id}`, { method: 'DELETE' }) } catch { toast.error('Could not delete the scenario') }
  }

  const input = 'h-8 rounded border border-gray-300 px-2 text-[13px] focus:border-[#0075DD] focus:outline-none'

  return (
    <Card title="What if" className="mb-4" action={!readOnly && <AddButton onClick={() => void add()}>New scenario</AddButton>}>
      {loading ? (
        <p className="py-2 text-sm text-gray-400">Loading…</p>
      ) : !items.length ? (
        <p className="py-2 text-sm text-gray-400">
          Nothing yet. <strong>New scenario</strong> starts an empty {year} year — enter the kinds of income you might have and the tax works itself out.
        </p>
      ) : (
        <div className="space-y-5">
          {items.map((it) => {
            const result = computeWhatIf(it.lines, business ? 'business' : 'personal', it.year, province)
            const delta = result.totalTax - projectedTax
            return (
              <div key={it.id} className="rounded-lg border border-gray-200 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <input value={it.name} disabled={readOnly} onChange={(e) => patch(it.id, (p) => ({ ...p, name: e.target.value }))}
                    className={`${input} flex-1 font-medium`} placeholder="Scenario name" />
                  {!readOnly && <button type="button" className={iconBtnDanger} title="Delete scenario" onClick={() => void remove(it.id)}><TrashIcon /></button>}
                </div>

                <div className="space-y-1.5">
                  {it.lines.map((l, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-1.5">
                      <select value={l.type} disabled={readOnly} title={LINE_META[l.type].hint}
                        onChange={(e) => patch(it.id, (p) => ({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, type: e.target.value as WhatIfLineType } : x)) }))}
                        className={`${input} w-[190px] bg-white`}>
                        {types.map((t) => <option key={t} value={t}>{LINE_META[t].label}</option>)}
                      </select>
                      <input value={l.label} disabled={readOnly} placeholder="Note (optional)"
                        onChange={(e) => patch(it.id, (p) => ({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }))}
                        className={`${input} min-w-0 flex-1`} />
                      <input type="number" value={l.amount || ''} disabled={readOnly} placeholder="0"
                        onChange={(e) => patch(it.id, (p) => ({ ...p, lines: p.lines.map((x, j) => (j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x)) }))}
                        className={`${input} w-32 text-right tabular-nums`} />
                      {!readOnly && (
                        <button type="button" className={iconBtnDanger} title="Remove line"
                          onClick={() => patch(it.id, (p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}><TrashIcon /></button>
                      )}
                    </div>
                  ))}
                </div>

                {!readOnly && (
                  <button type="button" onClick={() => patch(it.id, (p) => ({ ...p, lines: [...p.lines, { type: types[0], label: '', amount: 0 }] }))}
                    className="mt-2 rounded px-1.5 py-0.5 text-[12px] text-[#0747A6] hover:bg-[#DEEBFF]">+ line</button>
                )}

                <div className="mt-3 grid gap-2 border-t border-gray-100 pt-3 sm:grid-cols-4">
                  {[
                    { label: business ? 'Net income' : 'Taxable income', value: fmtMoney(result.taxableIncome) },
                    { label: 'Tax bill', value: fmtMoney(result.totalTax) },
                    { label: 'Effective rate', value: `${result.effectiveRate.toFixed(1)}%` },
                    { label: business ? 'After tax' : 'Take home', value: fmtMoney(result.afterTax) },
                  ].map((m) => (
                    <div key={m.label}>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400">{m.label}</p>
                      <p className="text-[15px] font-semibold tabular-nums text-gray-900">{m.value}</p>
                    </div>
                  ))}
                </div>

                <p className="mt-2 text-[12px] text-gray-500">
                  {delta === 0 ? 'Same as the projected bill.' : (
                    <>
                      <span className={delta > 0 ? 'text-[#BF2600]' : 'text-[#006644]'}>{delta > 0 ? '+' : '−'}{fmtMoney(Math.abs(delta))}</span>
                      {' '}versus the projected {fmtMoney(projectedTax)} · set aside {fmtMoney(result.monthlySetAside)}/mo
                    </>
                  )}
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-gray-400">
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
