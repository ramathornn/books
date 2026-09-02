'use client'

import { useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import EditableTable from '@/components/forecasts/EditableTable'
import { AreaChart, CHART_COLORS } from '@/components/forecasts/charts'
import { AddButton, Card, Hero, iconBtn, iconBtnDanger, InlineAdd, RenameControl, SectionTitle, TrashIcon, EyeIcon } from '@/components/forecasts/ui'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import type { DebtSettings } from '@/lib/forecasts/types'
import { fmtMoney } from '@/lib/forecasts/computed'
import { toast } from '@/lib/toast'

function DebtSettingsModal({ debtKey, onClose }: { debtKey: string; onClose: () => void }) {
  const { data, updateDebtSettings } = useForecast()
  const s: DebtSettings = data.debtSettings[debtKey] ?? { type: 'simple', interestRate: 0, amortizationMonths: null, remainingMonths: null, linkedExpense: null, linkedAsset: null }
  const [type, setType] = useState<DebtSettings['type']>(s.type)
  const [rate, setRate] = useState(s.interestRate ? String(s.interestRate) : '')
  const [amort, setAmort] = useState(s.amortizationMonths ? String(s.amortizationMonths) : '')
  const [remaining, setRemaining] = useState(s.remainingMonths ? String(s.remainingMonths) : '')
  const [linkedExpense, setLinkedExpense] = useState(s.linkedExpense ?? '')
  const [linkedAsset, setLinkedAsset] = useState(s.linkedAsset ?? '')
  const expenseKeys = Object.keys(data.expenses).filter((k) => !k.startsWith('_'))
  const assetKeys = Object.keys(data.assets)
  const field = 'mb-3 block text-sm'
  const input = 'mt-1 h-9 w-full rounded border border-gray-300 px-2 text-sm focus:border-[#0075DD] focus:outline-none'

  const save = () => {
    updateDebtSettings(debtKey, {
      type,
      interestRate: parseFloat(rate) || 0,
      amortizationMonths: parseInt(amort, 10) || null,
      remainingMonths: parseInt(remaining, 10) || null,
      linkedExpense: linkedExpense || null,
      linkedAsset: linkedAsset || null,
    })
    toast.success('Debt settings saved')
    onClose()
  }

  return (
    <Modal isOpen onClose={onClose} title={`Debt settings — ${debtKey}`}>
      <label className={field}>Type
        <select value={type} onChange={(e) => setType(e.target.value as DebtSettings['type'])} className={input}>
          <option value="simple">Simple paydown</option>
          <option value="loan">Amortizing loan</option>
        </select>
      </label>
      <label className={field}>Annual interest rate (%)
        <input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 19.99 (card) or 4.5 (loan)" className={input} />
      </label>
      {type === 'loan' && (
        <div className="grid grid-cols-2 gap-3">
          <label className={field}>Amortization (months)<input type="number" value={amort} onChange={(e) => setAmort(e.target.value)} placeholder="e.g. 300" className={input} /></label>
          <label className={field}>Months remaining<input type="number" value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder="overrides amortization" className={input} /></label>
        </div>
      )}
      <label className={field}>Monthly payment from (expense)
        <select value={linkedExpense} onChange={(e) => setLinkedExpense(e.target.value)} className={input}>
          <option value="">None — manual entry</option>
          {expenseKeys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label className={field}>Linked asset
        <select value={linkedAsset} onChange={(e) => setLinkedAsset(e.target.value)} className={input}>
          <option value="">None</option>
          {assetKeys.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <p className="mb-4 text-[12px] text-gray-500">Enter the opening balance in the first month. With a linked expense the balance runs down by each month&apos;s payment; with an interest rate and no link, positive cells reset the balance and negative cells are payments.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
        <button type="button" onClick={save} className="rounded bg-[#038A06] px-4 py-2 text-sm font-medium text-white hover:bg-[#026e05]">Save</button>
      </div>
    </Modal>
  )
}

export default function DebtsClient() {
  const { data, computed, addReceivable, removeRow, renameRow, toggleRowVisibility, reorderRow, readOnly } = useForecast()
  const { viewMonths, from, todayIdx, debtBalances } = computed
  const [showAdd, setShowAdd] = useState(false)
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const [settingsKey, setSettingsKey] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const hidden = data._hidden.receivables ?? {}
  const all = Object.keys(data.receivables)
  const visible = all.filter((n) => !hidden[n])
  const current = (n: string) => Math.max(0, (debtBalances[n] || [])[todayIdx] || 0)
  const peakOf = (n: string) => Math.max(0, ...(debtBalances[n] || []).slice(0, todayIdx + 1))
  const totalOutstanding = visible.reduce((s, n) => s + current(n), 0)
  const totalPeak = visible.reduce((s, n) => s + peakOf(n), 0)
  const paidPct = totalPeak > 0 ? ((totalPeak - totalOutstanding) / totalPeak) * 100 : 0
  const trajectory = viewMonths.map((month, i) => { const row: Record<string, number | string> = { month }; visible.forEach((n) => { row[n] = (debtBalances[n] || [])[from + i] || 0 }); return row })

  const dS = data.debtSettings
  const isComputed = (k: string) => { const s = dS[k]; return !!s && (!!s.linkedExpense || s.interestRate > 0 || (s.type === 'loan' && !!(s.amortizationMonths || s.remainingMonths))) }
  const anyComputed = all.some(isComputed)
  const editableComputed = Object.fromEntries(all.filter((k) => { const s = dS[k]; return !!s && s.interestRate > 0 && !s.linkedExpense && !(s.type === 'loan' && (s.amortizationMonths || s.remainingMonths)) }).map((k) => [k, true]))

  return (
    <div>
      <Hero label="Total outstanding" value={fmtMoney(totalOutstanding)} badge={`${paidPct.toFixed(1)}% paid`} badgeTone="green"
        sub={<>{visible.filter((n) => current(n) > 0).length} active accounts · Peak {fmtMoney(totalPeak)}</>} />

      <Card className="mb-6" title="Paydown trajectories">
        {visible.length ? <AreaChart data={trajectory} areas={visible.map((n, i) => ({ dataKey: n, color: CHART_COLORS[i % CHART_COLORS.length] }))} height={300} /> : <p className="text-sm text-gray-400">Add a debt account to see its trajectory.</p>}
      </Card>

      <div className="mb-3 flex items-start justify-between gap-3">
        <SectionTitle sub="Click any value to edit · Use the gear to link payments from an expense or set interest and amortization">Debts data</SectionTitle>
        <div className="flex gap-2">
          <AddButton onClick={() => setShowAll(true)}>View all ({all.length})</AddButton>
          {!readOnly && <AddButton onClick={() => setShowAdd(true)}>Add account</AddButton>}
        </div>
      </div>
      {showAdd && <InlineAdd placeholder="Account name…" onCancel={() => setShowAdd(false)} onSubmit={async (name) => { if (await addReceivable(name)) { toast.success(`Added ${name}`); setShowAdd(false) } }} />}

      <EditableTable section="receivables" columns={viewMonths} hideTotals
        rows={visible.map((k) => ({ key: k, label: k }))}
        computedValues={anyComputed ? debtBalances : null}
        editableComputedKeys={editableComputed}
        onReorder={readOnly ? null : (d, t, p) => reorderRow('receivables', d, t, p)}
        rowActions={readOnly ? null : (row) => (
          <span className="inline-flex items-center gap-0.5">
            <RenameControl value={row.key} onRename={(n) => { renameRow('receivables', row.key, n); toast.success(`Renamed to ${n}`) }} />
            <button type="button" className={`${iconBtn} ${dS[row.key]?.linkedExpense ? 'text-[#0075DD]' : ''}`} title="Debt settings" onClick={() => setSettingsKey(row.key)}>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.3 4.3a1.7 1.7 0 013.4 0l.1.6a1.7 1.7 0 002.5 1l.5-.3a1.7 1.7 0 012.4 2.4l-.3.5a1.7 1.7 0 001 2.5l.6.1a1.7 1.7 0 010 3.4l-.6.1a1.7 1.7 0 00-1 2.5l.3.5a1.7 1.7 0 01-2.4 2.4l-.5-.3a1.7 1.7 0 00-2.5 1l-.1.6a1.7 1.7 0 01-3.4 0l-.1-.6a1.7 1.7 0 00-2.5-1l-.5.3a1.7 1.7 0 01-2.4-2.4l.3-.5a1.7 1.7 0 00-1-2.5l-.6-.1a1.7 1.7 0 010-3.4l.6-.1a1.7 1.7 0 001-2.5l-.3-.5a1.7 1.7 0 012.4-2.4l.5.3a1.7 1.7 0 002.5-1z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
            <button type="button" className={iconBtn} title="Hide from totals and charts" onClick={() => { toggleRowVisibility('receivables', row.key); toast.success(`Hidden ${row.key}`) }}><EyeIcon /></button>
            <button type="button" className={iconBtnDanger} title="Delete" onClick={() => setConfirmKey(row.key)}><TrashIcon /></button>
          </span>
        )} />

      {settingsKey && <DebtSettingsModal debtKey={settingsKey} onClose={() => setSettingsKey(null)} />}

      <Modal isOpen={showAll} onClose={() => setShowAll(false)} title="All debts">
        <p className="mb-3 text-[12px] text-gray-500">{all.length} accounts · {Object.values(hidden).filter(Boolean).length} hidden</p>
        <ul className="divide-y divide-gray-100">
          {all.map((n, i) => (
            <li key={n} className={`flex items-center gap-3 py-2 text-sm ${hidden[n] ? 'opacity-60' : ''}`}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: hidden[n] ? '#E1E6EB' : CHART_COLORS[i % CHART_COLORS.length] }} />
              <span className="flex-1 text-gray-800">{n}</span>
              <span className="tabular-nums text-gray-600">{fmtMoney(current(n))}</span>
              {!readOnly && <button type="button" className="rounded border border-gray-300 px-2 py-0.5 text-[12px] text-gray-700 hover:bg-gray-50" onClick={() => toggleRowVisibility('receivables', n)}>{hidden[n] ? 'Show' : 'Hide'}</button>}
            </li>
          ))}
          {!all.length && <li className="py-2 text-sm text-gray-400">No debts yet.</li>}
        </ul>
      </Modal>

      <ConfirmDialog isOpen={!!confirmKey} title={`Delete "${confirmKey ?? ''}"?`} message="This account and all its values will be permanently removed." confirmLabel="Delete" variant="danger"
        onConfirm={() => { if (confirmKey) { removeRow('receivables', confirmKey); toast.success(`Deleted ${confirmKey}`) } setConfirmKey(null) }} onCancel={() => setConfirmKey(null)} />
    </div>
  )
}
