'use client'

import { useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import { CHART_COLORS, DonutChart } from '@/components/forecasts/charts'
import { AddButton, Card, CategoryBars, Hero, iconBtnDanger, MetricGrid, RenameControl, SectionTitle, TrashIcon } from '@/components/forecasts/ui'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import type { Asset } from '@/lib/forecasts/types'
import { fmtMoney } from '@/lib/forecasts/computed'
import { toast } from '@/lib/toast'

const TYPES: { value: Asset['type']; label: string }[] = [
  { value: 'property', label: 'Property' }, { value: 'vehicle', label: 'Vehicle' }, { value: 'investment', label: 'Investment' }, { value: 'cash', label: 'Cash' }, { value: 'other', label: 'Other' },
]
const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label ?? 'Other'

export default function AssetsClient() {
  const { data, computed, addAsset, updateAsset, removeAsset, renameAsset, readOnly } = useForecast()
  const { netWorth, totalAssetValue, totalLiabilities, assetsByType, todayIdx, debtBalances } = computed
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', value: '', type: 'other' as Asset['type'], linkedDebt: '' })
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const entries = Object.entries(data.assets)
  const debtKeys = Object.keys(data.receivables)
  const input = 'h-9 rounded border border-gray-300 px-2 text-sm focus:border-[#0075DD] focus:outline-none'

  const submit = async () => {
    if (!form.name.trim()) return
    if (await addAsset(form.name, parseFloat(form.value) || 0, form.type, form.linkedDebt || null)) {
      toast.success(`Added ${form.name.trim()}`); setForm({ name: '', value: '', type: 'other', linkedDebt: '' }); setShowAdd(false)
    }
  }
  const byType = Object.entries(assetsByType).map(([t, items]) => ({ name: typeLabel(t), total: items.reduce((s, a) => s + a.value, 0) })).filter((d) => d.total > 0).sort((a, b) => b.total - a.total)

  return (
    <div>
      <Hero label="Total asset value" value={fmtMoney(totalAssetValue)} badge={`Net worth ${fmtMoney(netWorth)}`} badgeTone={netWorth >= 0 ? 'green' : 'red'} sub={<>{entries.length} assets · {fmtMoney(totalLiabilities)} in liabilities</>} />
      <MetricGrid metrics={[
        { label: 'Total assets', value: fmtMoney(totalAssetValue), sub: `${entries.length} assets` },
        { label: 'Total liabilities', value: fmtMoney(totalLiabilities), sub: `${debtKeys.filter((k) => ((debtBalances[k] || [])[todayIdx] || 0) > 0).length} active debts`, neg: totalLiabilities > 0 },
        { label: 'Net worth', value: fmtMoney(netWorth), sub: 'Assets − liabilities', neg: netWorth < 0 },
      ]} />

      <div className="mb-3 flex items-start justify-between gap-3">
        <SectionTitle sub="Click a value to edit it · Link a debt to see equity">Assets</SectionTitle>
        {!readOnly && <AddButton onClick={() => setShowAdd(true)}>Add asset</AddButton>}
      </div>
      {showAdd && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input autoFocus placeholder="Asset name…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') setShowAdd(false) }} className={`${input} min-w-[200px]`} />
          <input type="number" placeholder="Value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} className={`${input} w-32`} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Asset['type'] })} className={input}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
          <select value={form.linkedDebt} onChange={(e) => setForm({ ...form, linkedDebt: e.target.value })} className={input}><option value="">No linked debt</option>{debtKeys.map((k) => <option key={k}>{k}</option>)}</select>
          <button type="button" onClick={() => void submit()} className="h-9 rounded bg-[#038A06] px-3 text-sm font-medium text-white hover:bg-[#026e05]">Add</button>
          <button type="button" onClick={() => setShowAdd(false)} className="h-9 rounded border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map(([name, a], i) => {
          const linkedBalance = a.linkedDebt ? Math.max(0, (debtBalances[a.linkedDebt] || [])[todayIdx] || 0) : 0
          const equity = a.value - linkedBalance
          return (
            <div key={name} className="rounded-lg border border-gray-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="flex-1 truncate text-sm font-medium text-gray-900">{name}</span>
                {!readOnly && <RenameControl value={name} onRename={(n) => { renameAsset(name, n); toast.success(`Renamed to ${n}`) }} />}
                {!readOnly && <button type="button" className={iconBtnDanger} title="Delete" onClick={() => setConfirmKey(name)}><TrashIcon /></button>}
              </div>
              {editingValue === name ? (
                <div className="mb-2 flex items-center gap-1">
                  <input autoFocus type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { const v = parseFloat(editValue); if (Number.isFinite(v)) updateAsset(name, { value: v }); setEditingValue(null) } if (e.key === 'Escape') setEditingValue(null) }} onBlur={() => setEditingValue(null)} className={`${input} w-36`} />
                </div>
              ) : (
                <button type="button" disabled={readOnly} onClick={() => { setEditingValue(name); setEditValue(String(a.value)) }} className="mb-2 text-xl font-semibold tabular-nums text-gray-900 hover:text-[#0075DD] disabled:hover:text-gray-900">{fmtMoney(a.value)}</button>
              )}
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-500">
                <select value={a.type} disabled={readOnly} onChange={(e) => updateAsset(name, { type: e.target.value as Asset['type'] })} className="h-7 rounded border border-gray-300 bg-white px-1 text-[12px]">{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
                <select value={a.linkedDebt ?? ''} disabled={readOnly} onChange={(e) => { updateAsset(name, { linkedDebt: e.target.value || null }); toast.success(e.target.value ? `Linked to ${e.target.value}` : 'Unlinked') }} className="h-7 rounded border border-gray-300 bg-white px-1 text-[12px]"><option value="">No linked debt</option>{debtKeys.map((k) => <option key={k}>{k}</option>)}</select>
              </div>
              {a.linkedDebt && <p className="mt-2 text-[12px]">Owes {fmtMoney(linkedBalance)} · <span className={equity >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}>Equity {fmtMoney(equity)}</span></p>}
            </div>
          )
        })}
        {!entries.length && !showAdd && <p className="text-sm text-gray-400">No assets yet.</p>}
      </div>

      {byType.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <Card title="Asset breakdown"><CategoryBars items={byType} colors={CHART_COLORS} /></Card>
          <Card title="Allocation"><DonutChart data={byType.map((d) => ({ name: d.name, value: d.total }))} /></Card>
        </div>
      )}

      <ConfirmDialog isOpen={!!confirmKey} title={`Delete "${confirmKey ?? ''}"?`} message="This asset will be permanently removed." confirmLabel="Delete" variant="danger"
        onConfirm={() => { if (confirmKey) { removeAsset(confirmKey); toast.success(`Deleted ${confirmKey}`) } setConfirmKey(null) }} onCancel={() => setConfirmKey(null)} />
    </div>
  )
}
