'use client'

import { useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import { AreaChart, BarChart, CHART_COLORS } from '@/components/forecasts/charts'
import CashFlowTimeline from '@/components/forecasts/CashFlowTimeline'
import { Card, Hero, iconBtnDanger, TrashIcon } from '@/components/forecasts/ui'
import { fmtMoney } from '@/lib/forecasts/computed'
import { currentMonthIndex, daysInMonth } from '@/lib/forecasts/months'
import { toast } from '@/lib/toast'

export default function CashFlowClient() {
  const { data, computed, setBankBalance, clearBankBalance, readOnly } = useForecast()
  const { viewMonths, viewNet, viewBalance, sumNet, lastBalance, ratio, from } = computed
  const [view, setView] = useState<'timeline' | 'monthly'>('timeline')
  const minBal = Math.min(...viewBalance), maxBal = Math.max(...viewBalance)
  const todayIdx = currentMonthIndex(data.months)

  const [showRecord, setShowRecord] = useState(false)
  const [recordMonth, setRecordMonth] = useState(todayIdx)
  const [recordDay, setRecordDay] = useState(new Date().getDate())
  const [recordAmount, setRecordAmount] = useState('')
  const [pulling, setPulling] = useState(false)

  // Books is the source of truth for cash: sum of bank-account GL balances as of the chosen day.
  const pullFromBooks = async () => {
    setPulling(true)
    try {
      const p = data.months[recordMonth]
      const m = /^(\w+)'(\d+)$/.exec(p ?? '')
      const monthNum = m ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m[1]) + 1 : 0
      const asOf = m ? `20${m[2]}-${String(monthNum).padStart(2, '0')}-${String(recordDay).padStart(2, '0')}` : ''
      const res = await fetch(`/api/forecasts/books/cash?asOf=${asOf}`, { cache: 'no-store' })
      if (!res.ok) throw new Error((await res.json()).error || 'Could not read Books balances')
      const { data: d } = await res.json()
      setRecordAmount(String(d.total))
      toast.success(`Books cash on hand ${fmtMoney(d.total)} across ${d.accounts.length} account${d.accounts.length === 1 ? '' : 's'}`)
    } catch (e) { toast.error((e as Error).message) } finally { setPulling(false) }
  }

  const snapshots = Object.entries(data.bankBalances).map(([idx, s]) => ({ idx: Number(idx), ...s, label: data.months[Number(idx)] })).filter((s) => s.label).sort((a, b) => a.idx - b.idx)

  const handleRecord = () => {
    const val = parseFloat(recordAmount)
    if (!Number.isFinite(val)) return
    const day = Math.min(Math.max(1, recordDay), daysInMonth(data.months[recordMonth]))
    setBankBalance(recordMonth, val, day)
    toast.success(`Balance recorded: ${fmtMoney(val)} at ${data.months[recordMonth]} ${day}`)
    setShowRecord(false); setRecordAmount('')
  }

  const tab = (v: typeof view) => `rounded px-3 py-1.5 text-[13px] ${view === v ? 'bg-[#0075DD] text-white' : 'text-gray-600 hover:bg-gray-100'}`
  const input = 'h-9 rounded border border-gray-300 px-2 text-sm focus:border-[#0075DD] focus:outline-none'

  return (
    <div>
      <Hero label="Ending balance" value={fmtMoney(lastBalance)} negative={lastBalance < 0} badge={`${sumNet >= 0 ? '▲' : '▼'} ${fmtMoney(sumNet)} net`} badgeTone={sumNet >= 0 ? 'green' : 'red'}
        sub={<>Peak {fmtMoney(maxBal)} ({viewMonths[viewBalance.indexOf(maxBal)]}) · Low {fmtMoney(minBal)} ({viewMonths[viewBalance.indexOf(minBal)]})</>} />

      <div className="mb-4 inline-flex rounded border border-gray-200 bg-white p-0.5">
        <button type="button" className={tab('timeline')} onClick={() => setView('timeline')}>Timeline</button>
        <button type="button" className={tab('monthly')} onClick={() => setView('monthly')}>Monthly</button>
      </div>

      {view === 'timeline' && <div className="mb-6"><CashFlowTimeline /></div>}

      <Card className="mb-6" title="Cash on hand" action={!readOnly && (
        <button type="button" onClick={() => { setShowRecord(!showRecord); setRecordMonth(todayIdx); setRecordDay(new Date().getDate()) }} className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">{showRecord ? 'Cancel' : 'Record balance'}</button>
      )}>
        {showRecord && (
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-gray-500">Month<br /><select value={recordMonth} onChange={(e) => setRecordMonth(Number(e.target.value))} className={input}>{data.months.map((m, i) => <option key={i} value={i}>{m}</option>)}</select></label>
            <label className="text-[12px] text-gray-500">Day<br /><select value={recordDay} onChange={(e) => setRecordDay(Number(e.target.value))} className={input}>{Array.from({ length: daysInMonth(data.months[recordMonth]) }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <label className="text-[12px] text-gray-500">Balance<br /><input type="number" step="any" autoFocus value={recordAmount} onChange={(e) => setRecordAmount(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleRecord(); if (e.key === 'Escape') setShowRecord(false) }} placeholder="e.g. 25000" className={`${input} w-40`} /></label>
            <button type="button" onClick={() => void pullFromBooks()} disabled={pulling} className="h-9 rounded border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">{pulling ? 'Reading…' : 'Use Books balance'}</button>
            <button type="button" onClick={handleRecord} className="h-9 rounded bg-[#038A06] px-4 text-sm font-medium text-white hover:bg-[#026e05]">Save</button>
          </div>
        )}
        {data.linkedBank && (
          <div className="mb-2 flex items-center gap-3 rounded bg-[#DEEBFF]/60 px-3 py-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-[#0075DD]" />
            <span className="text-gray-700">Anchored to Books banking as of {data.linkedBank.asOf}</span>
            <span className="ml-auto font-medium tabular-nums text-gray-900">{fmtMoney(data.linkedBank.amount)}</span>
          </div>
        )}
        {snapshots.length > 0 && (
          <ul className="mb-2 divide-y divide-gray-100">
            {snapshots.map((s) => (
              <li key={s.idx} className="flex items-center gap-3 py-1.5 text-sm">
                <span className="h-2 w-2 rounded-full bg-[#2FA84F]" />
                <span className="text-gray-600">{s.label} · {s.day}</span>
                <span className="ml-auto font-medium tabular-nums text-gray-900">{fmtMoney(s.amount)}</span>
                {!readOnly && <button type="button" className={iconBtnDanger} title="Remove" onClick={() => { clearBankBalance(s.idx); toast.success(`Removed snapshot at ${s.label}`) }}><TrashIcon /></button>}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12px] text-gray-500">{data.booksLinked ? 'This scenario anchors to your Books bank balances automatically. Record a balance only to override a specific month.' : 'Record your total cash across all accounts to anchor the projection. Future months recalculate from that point.'}</p>
      </Card>

      {view === 'monthly' && (
        <>
          <Card className="mb-6"><AreaChart data={viewMonths.map((m, i) => ({ month: m, Balance: viewBalance[i], ...(data.bankBalances[String(from + i)] ? { Snapshot: viewBalance[i] } : {}) }))} areas={[{ dataKey: 'Balance', color: CHART_COLORS[0] }]} height={340} /></Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Income / expense ratio"><AreaChart data={viewMonths.map((m, i) => ({ month: m, Ratio: Math.round(ratio[i] * 100) / 100, 'Break even': 1 }))} areas={[{ dataKey: 'Ratio', color: CHART_COLORS[1] }, { dataKey: 'Break even', color: CHART_COLORS[4] }]} height={240} yFormatter={(v) => `${v.toFixed(1)}x`} valueFormatter={(v) => `${v.toFixed(2)}x`} /></Card>
            <Card title="Monthly surplus / deficit"><BarChart data={viewMonths.map((m, i) => ({ month: m, Amount: viewNet[i] }))} bars={[{ dataKey: 'Amount', name: 'Surplus / deficit', color: CHART_COLORS[1] }]} colorByValue height={240} /></Card>
          </div>
        </>
      )}
    </div>
  )
}
