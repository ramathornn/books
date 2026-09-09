'use client'

import { useMemo, useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import EditableTable, { type TableRow } from '@/components/forecasts/EditableTable'
import { AreaChart, CHART_COLORS, DonutChart } from '@/components/forecasts/charts'
import { AddButton, Card, CategoryBars, Hero, iconBtn, iconBtnDanger, InlineAdd, LinkedBadge, RenameControl, SectionTitle, TrashIcon, EyeIcon } from '@/components/forecasts/ui'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { fmtMoney } from '@/lib/forecasts/computed'
import { flatSetAside, monthlySetAside } from '@/lib/forecasts/setAside'
import { toast } from '@/lib/toast'

export default function ExpensesClient() {
  const { data, computed, asOfIndex, showTable, showCharts, addExpenseCategory, addExpenseItem, removeRow, renameRow, reorderRow, toggleRowVisibility, readOnly } = useForecast()
  const { viewMonths, viewExpenses, avgExpenses, categoryTotals, totalExpenses, totalIncome, from } = computed
  // Running totals through the selected month.
  const asOfTo = Math.max(from, asOfIndex)
  const sumExpenses = totalExpenses.slice(from, asOfTo + 1).reduce((a, b) => a + b, 0)
  const sumNet = totalIncome.slice(from, asOfTo + 1).reduce((a, b) => a + b, 0) - sumExpenses
  const asOfLabel = data.months[asOfIndex] ?? ''
  const [showAddCat, setShowAddCat] = useState(false)
  const [addItemCat, setAddItemCat] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const sortedCats = categoryTotals.filter((c) => c.total > 0).sort((a, b) => b.total - a.total)
  // Dividend owners must reserve the personal tax on the withdrawal that funds
  // this spending — a gross-up, not a slice of it. Salary withholds at source.
  const showSetAside = data.kind === 'personal' && data.salaryMethod === 'dividend'
  const flatMethod = data.setAsideMethod === 'flat'
  const setAside = useMemo(
    () => (showSetAside ? (flatMethod ? flatSetAside : monthlySetAside)(viewMonths, viewExpenses) : []),
    [showSetAside, flatMethod, viewMonths, viewExpenses]
  )
  // Debts that draw their monthly payment from an expense row.
  const debtsByExpense = useMemo(() => {
    const m: Record<string, string[]> = {}
    Object.entries(data.debtSettings).forEach(([debt, s]) => { if (s?.linkedExpense) (m[s.linkedExpense] ||= []).push(debt) })
    return m
  }, [data.debtSettings])
  const rows: TableRow[] = Object.keys(data.expenses).map((k) => ({ key: k, label: k.startsWith('_') ? k.slice(1) : k, isHeader: k.startsWith('_'), linked: !!data.linked.expenses?.[k], linkedNote: data.linked.expenses?.[k]?.note }))
  const confirmIsCat = !!confirmKey?.startsWith('_')

  return (
    <div>
      <Hero label="Total expenses" value={fmtMoney(sumExpenses)} negative badge={`Avg ${fmtMoney(Math.round(avgExpenses))}/mo`}
        sub={<>Net savings: <span className={sumNet >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}>{fmtMoney(sumNet)}</span> · {data.months[from]} through {asOfLabel}</>} />

{showCharts && (
      <Card className="mb-6"><AreaChart data={viewMonths.map((month, i) => ({ month, Expenses: viewExpenses[i] }))} areas={[{ dataKey: 'Expenses', color: CHART_COLORS[4] }]} height={300} /></Card>
      )}

{showCharts && (
      <div className="mb-6 grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="Category breakdown"><CategoryBars items={sortedCats} colors={CHART_COLORS} /></Card>
        <Card title="Distribution"><DonutChart data={sortedCats.map((c) => ({ name: c.name, value: c.total }))} /></Card>
      </div>
      )}

      <div className={`mb-3 flex items-start justify-between gap-3 ${showTable ? '' : 'hidden'}`}>
        <SectionTitle sub={data.booksLinked ? 'Rows tagged Books come from open bills, recurring templates and expenses, and categorized spend. Shaded months are Books: past and current months are actuals, and future months with a bill or recurring item are locked. Unshaded future months are yours to forecast; where you leave them empty, Books fills in the 3-month run rate.' : 'Click any value to edit · Type = for a formula · Drag the corner handle to fill · Click a row’s calendar icon to set the day the payment comes out (defaults to end of month) · Right-click a cell to override a single month'}>Expense data</SectionTitle>
        {!readOnly && <AddButton onClick={() => { setShowAddCat(true); setAddItemCat(null) }}>Add category</AddButton>}
      </div>
      {showAddCat && <InlineAdd placeholder="Category name…" onCancel={() => setShowAddCat(false)} onSubmit={async (name) => { if (await addExpenseCategory(name)) { toast.success(`Category added: ${name}`); setShowAddCat(false) } }} />}
      {addItemCat && <InlineAdd prefix={<span className="text-sm text-gray-500">Under <span className="font-medium text-gray-800">{addItemCat}</span>:</span>} placeholder="Line item name…" onCancel={() => setAddItemCat(null)} onSubmit={async (name) => { if (await addExpenseItem(name, addItemCat)) { toast.success(`Added ${name}`); setAddItemCat(null) } }} />}

      <EditableTable section="expenses" columns={viewMonths} rows={rows} enableDayAssignment
        totalRow={{ label: 'Total expenses', values: viewExpenses }}
        preTotalRows={showSetAside ? [{
          label: 'CRA FY set-aside',
          values: setAside,
          note: flatMethod
            ? 'Personal tax to hold back on the dividend withdrawal that funds this spending. To have $1 left to spend you must withdraw more than $1, so this is the tax on the grossed-up draw — not a flat share of expenses. Flat mode annualizes your run rate and reserves the same rate every month, so a mid-year start is priced at the brackets the draws will actually reach. Change it in Settings → Salary method.'
            : 'Personal tax to hold back on the dividend withdrawal that funds this spending. To have $1 left to spend you must withdraw more than $1, so this is the tax on the grossed-up draw — not a flat share of expenses. Auto mode walks the brackets, so it rises through the year and resets in January. Change it in Settings → Salary method.',
        }] : []}
        onReorder={readOnly ? null : (d, t, p) => reorderRow('expenses', d, t, p)}
        rowActions={readOnly ? null : (row) => row.linked ? (
          debtsByExpense[row.key]?.length ? <LinkedBadge to={`${debtsByExpense[row.key].join(' · ')} (debt)`} /> : null
        ) : (
          <span className="inline-flex items-center gap-0.5">
            {!!debtsByExpense[row.key]?.length && <LinkedBadge to={`${debtsByExpense[row.key].join(' · ')} (debt)`} />}
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
