'use client'

import { useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import EditableTable from '@/components/forecasts/EditableTable'
import { AreaChart, BarChart, CHART_COLORS, DonutChart } from '@/components/forecasts/charts'
import { AddButton, Card, Hero, iconBtn, iconBtnDanger, InlineAdd, RenameControl, SectionTitle, TrashIcon, EyeIcon } from '@/components/forecasts/ui'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { convertToCAD, FORECAST_CURRENCIES } from '@/lib/forecasts/currency'
import { fmtMoney } from '@/lib/forecasts/computed'
import { resolveValue } from '@/lib/forecasts/formula'
import { toast } from '@/lib/toast'

export default function IncomeClient() {
  const { data, computed, rates, addRevenueItem, removeRow, renameRow, setIncomeCurrency, reorderRow, toggleRowVisibility, importBooksRevenue, readOnly } = useForecast()
  const [importing, setImporting] = useState(false)
  const { viewMonths, viewIncome, sumIncome, avgIncome, growth, from, to } = computed
  const lastGrowth = growth[growth.length - 1] ?? 0
  const [showAdd, setShowAdd] = useState(false)
  const [newCurrency, setNewCurrency] = useState('CAD')
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const currencies = data.incomeCurrencies
  const keys = Object.entries(data.income).filter(([k, arr]) => !k.startsWith('_') && arr).map(([k]) => k)
  const stacked = viewMonths.map((month, i) => { const row: Record<string, number | string> = { month }; keys.forEach((k) => { row[k] = convertToCAD(resolveValue(data.income[k][from + i], data, from + i), currencies[k] || 'CAD', rates) }); return row })
  const donut = keys.map((k) => ({ name: k, value: data.income[k].slice(from, to + 1).reduce<number>((a, v, i) => a + convertToCAD(resolveValue(v, data, from + i), currencies[k] || 'CAD', rates), 0) })).filter((d) => d.value > 0)
  const select = 'h-7 rounded border border-gray-300 bg-white px-1 text-[12px]'

  return (
    <div>
      <Hero label="Total income (CAD)" value={fmtMoney(sumIncome)} badge={`${lastGrowth >= 0 ? '▲' : '▼'} ${lastGrowth.toFixed(1)}% MoM`} badgeTone={lastGrowth >= 0 ? 'green' : 'red'}
        sub={<>Avg {fmtMoney(Math.round(avgIncome))}/mo <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">USD {rates.USD.toFixed(3)}</span> <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px]">EUR {rates.EUR.toFixed(3)}</span></>} />

      <Card className="mb-6"><BarChart data={stacked} bars={keys.map((k, i) => ({ dataKey: k, color: CHART_COLORS[i % CHART_COLORS.length] }))} stacked showLegend height={300} /></Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="Month-over-month growth"><AreaChart data={viewMonths.map((month, i) => ({ month, Growth: growth[i] }))} areas={[{ dataKey: 'Growth', color: CHART_COLORS[2], name: 'Growth %' }]} height={220} yFormatter={(v) => `${v.toFixed(0)}%`} valueFormatter={(v) => `${v.toFixed(1)}%`} /></Card>
        <Card title="Income mix"><DonutChart data={donut} /></Card>
      </div>

      <div className="mb-3 flex items-start justify-between gap-3">
        <SectionTitle sub={data.booksLinked ? 'Rows tagged Books are active clients (invoiced this or last month). Shaded months are Books: past and current months show actuals, and any future month with an invoice, draft or recurring template is locked to it. Unshaded future months are yours to forecast; Books replaces them as you invoice.' : 'Click any value to edit · Type = for a formula · Drag the corner handle to fill · Right-click a cell to set the day it lands on · Values in source currency, totals in CAD'}>Income data</SectionTitle>
        {!readOnly && (
          <div className="flex gap-2">
            {!data.booksLinked && <button type="button" disabled={importing} title="Fill a row with invoiced revenue from Books, in CAD, for every month in the workbook" onClick={async () => { setImporting(true); if (await importBooksRevenue()) toast.success('Imported invoiced revenue from Books'); setImporting(false) }} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{importing ? 'Importing…' : 'Import from Books'}</button>}
            <AddButton onClick={() => setShowAdd(true)}>Add source</AddButton>
          </div>
        )}
      </div>
      {showAdd && (
        <InlineAdd placeholder="Income source name…" onCancel={() => setShowAdd(false)}
          extra={<select value={newCurrency} onChange={(e) => setNewCurrency(e.target.value)} className="h-9 rounded border border-gray-300 bg-white px-2 text-sm">{FORECAST_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>}
          onSubmit={async (name) => { if (await addRevenueItem(name, newCurrency)) { toast.success(`Added ${name}`); setShowAdd(false); setNewCurrency('CAD') } }} />
      )}

      <EditableTable section="income" columns={viewMonths} enableDayAssignment
        rows={keys.map((k) => ({ key: k, label: k, currency: currencies[k] || 'CAD', linked: !!data.linked.income?.[k], linkedNote: data.linked.income?.[k]?.note }))}
        totalRow={{ label: 'Total income (CAD)', values: viewIncome }}
        onReorder={readOnly ? null : (d, t, p) => reorderRow('income', d, t, p)}
        rowActions={readOnly ? null : (row) => row.linked ? <span className="text-[11px] text-gray-400">CAD</span> : (
          <span className="inline-flex items-center gap-0.5">
            <select value={row.currency} onChange={(e) => { setIncomeCurrency(row.key, e.target.value); toast.success(`${row.key} → ${e.target.value}`) }} className={select}>{FORECAST_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            <RenameControl value={row.key} onRename={(n) => { renameRow('income', row.key, n); toast.success(`Renamed to ${n}`) }} />
            <button type="button" className={iconBtn} title={data._hidden.income?.[row.key] ? 'Show in timeline' : 'Hide from timeline'} onClick={() => toggleRowVisibility('income', row.key)}><EyeIcon off={!!data._hidden.income?.[row.key]} /></button>
            <button type="button" className={iconBtnDanger} title="Delete" onClick={() => setConfirmKey(row.key)}><TrashIcon /></button>
          </span>
        )} />

      <ConfirmDialog isOpen={!!confirmKey} title={`Delete "${confirmKey ?? ''}"?`} message="This row and all its values will be permanently removed." confirmLabel="Delete" variant="danger"
        onConfirm={() => { if (confirmKey) { removeRow('income', confirmKey); toast.success(`Deleted ${confirmKey}`) } setConfirmKey(null) }} onCancel={() => setConfirmKey(null)} />
    </div>
  )
}
