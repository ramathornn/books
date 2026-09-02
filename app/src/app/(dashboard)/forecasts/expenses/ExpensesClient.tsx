'use client'

import { useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import EditableTable, { type TableRow } from '@/components/forecasts/EditableTable'
import { BarChart, CHART_COLORS, DonutChart } from '@/components/forecasts/charts'
import { AddButton, Card, CategoryBars, Hero, iconBtn, iconBtnDanger, InlineAdd, RenameControl, SectionTitle, TrashIcon, EyeIcon } from '@/components/forecasts/ui'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { fmtMoney } from '@/lib/forecasts/computed'
import { toast } from '@/lib/toast'

export default function ExpensesClient() {
  const { data, computed, addExpenseCategory, addExpenseItem, removeRow, renameRow, reorderRow, toggleRowVisibility, readOnly } = useForecast()
  const { viewMonths, viewExpenses, sumExpenses, avgExpenses, sumNet, categoryTotals } = computed
  const [showAddCat, setShowAddCat] = useState(false)
  const [addItemCat, setAddItemCat] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const sortedCats = categoryTotals.filter((c) => c.total > 0).sort((a, b) => b.total - a.total)
  const stacked = viewMonths.map((month, i) => { const row: Record<string, number | string> = { month }; categoryTotals.forEach((c) => { row[c.name] = c.viewTotals[i] }); return row })
  const rows: TableRow[] = Object.keys(data.expenses).map((k) => ({ key: k, label: k.startsWith('_') ? k.slice(1) : k, isHeader: k.startsWith('_'), linked: !!data.linked.expenses?.[k], linkedNote: data.linked.expenses?.[k]?.note }))
  const confirmIsCat = !!confirmKey?.startsWith('_')

  return (
    <div>
      <Hero label="Total expenses" value={fmtMoney(sumExpenses)} negative badge={`Avg ${fmtMoney(Math.round(avgExpenses))}/mo`}
        sub={<>Net savings: <span className={sumNet >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}>{fmtMoney(sumNet)}</span></>} />

      <Card className="mb-6"><BarChart data={stacked} bars={categoryTotals.filter((c) => c.total > 0).map((c, i) => ({ dataKey: c.name, color: CHART_COLORS[i % CHART_COLORS.length] }))} stacked showLegend height={300} /></Card>

      <div className="mb-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="Category breakdown"><CategoryBars items={sortedCats} colors={CHART_COLORS} /></Card>
        <Card title="Distribution"><DonutChart data={sortedCats.map((c) => ({ name: c.name, value: c.total }))} /></Card>
      </div>

      <div className="mb-3 flex items-start justify-between gap-3">
        <SectionTitle sub={data.booksLinked ? 'Rows tagged Books come from open bills, recurring templates and expenses, and categorized spend. Shaded months are Books: past and current months are actuals, and future months with a bill or recurring item are locked. Unshaded future months are yours to forecast; where you leave them empty, Books fills in the 3-month run rate.' : 'Click any value to edit · Type = for a formula · Drag the corner handle to fill · Right-click a cell to set the day it lands on'}>Expense data</SectionTitle>
        {!readOnly && <AddButton onClick={() => { setShowAddCat(true); setAddItemCat(null) }}>Add category</AddButton>}
      </div>
      {showAddCat && <InlineAdd placeholder="Category name…" onCancel={() => setShowAddCat(false)} onSubmit={async (name) => { if (await addExpenseCategory(name)) { toast.success(`Category added: ${name}`); setShowAddCat(false) } }} />}
      {addItemCat && <InlineAdd prefix={<span className="text-sm text-gray-500">Under <span className="font-medium text-gray-800">{addItemCat}</span>:</span>} placeholder="Line item name…" onCancel={() => setAddItemCat(null)} onSubmit={async (name) => { if (await addExpenseItem(name, addItemCat)) { toast.success(`Added ${name}`); setAddItemCat(null) } }} />}

      <EditableTable section="expenses" columns={viewMonths} rows={rows} enableDayAssignment
        totalRow={{ label: 'Total expenses', values: viewExpenses }}
        onReorder={readOnly ? null : (d, t, p) => reorderRow('expenses', d, t, p)}
        rowActions={readOnly ? null : (row) => row.linked ? null : (
          <span className="inline-flex items-center gap-0.5">
            {row.isHeader && <button type="button" className="whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-[#0747A6] hover:bg-[#DEEBFF]" onClick={() => { setAddItemCat(row.label); setShowAddCat(false) }}>+ item</button>}
            <RenameControl value={row.label} onRename={(n) => { renameRow('expenses', row.key, row.isHeader ? `_${n}` : n); toast.success(`Renamed to ${n}`) }} />
            {!row.isHeader && <button type="button" className={iconBtn} title={data._hidden.expenses?.[row.key] ? 'Show in timeline' : 'Hide from timeline'} onClick={() => toggleRowVisibility('expenses', row.key)}><EyeIcon off={!!data._hidden.expenses?.[row.key]} /></button>}
            <button type="button" className={iconBtnDanger} title="Delete" onClick={() => setConfirmKey(row.key)}><TrashIcon /></button>
          </span>
        )} />

      <ConfirmDialog isOpen={!!confirmKey} title={`Delete "${confirmKey?.replace(/^_/, '') ?? ''}"?`} confirmLabel="Delete" variant="danger"
        message={confirmIsCat ? 'The category and every item inside it will be permanently removed.' : 'This row and all its values will be permanently removed.'}
        onConfirm={() => { if (confirmKey) { removeRow('expenses', confirmKey); toast.success(`Deleted ${confirmKey.replace(/^_/, '')}`) } setConfirmKey(null) }} onCancel={() => setConfirmKey(null)} />
    </div>
  )
}
