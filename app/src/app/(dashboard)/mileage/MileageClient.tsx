'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Log {
  id: string
  date: string
  fromAddress: string
  toAddress: string
  kilometres: number
  purpose: string
  vehicleLabel: string
  ratePerKm: number
  amount: number
  notes: string
}

interface Props {
  year: string
  logs: Log[]
  summary: { count: number; totalKm: number; totalAmount: number }
}

export default function MileageClient({ year, logs, summary }: Props) {
  const router = useRouter()
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [fromAddress, setFromAddress] = useState('')
  const [toAddress, setToAddress] = useState('')
  const [kilometres, setKilometres] = useState('')
  const [purpose, setPurpose] = useState('')
  const [vehicleLabel, setVehicleLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function add() {
    setError('')
    if (!parseFloat(kilometres)) {
      setError('Enter kilometres.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/mileage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          fromAddress,
          toAddress,
          kilometres: parseFloat(kilometres),
          purpose,
          vehicleLabel,
          notes,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      setKilometres('')
      setFromAddress('')
      setToAddress('')
      setPurpose('')
      setNotes('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Archive this mileage entry?')) return
    const res = await fetch(`/api/mileage/${id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label={`${year} kilometres`} value={`${summary.totalKm.toFixed(2)} km`} accent="#0075DD" />
        <Stat label={`${year} entries`} value={String(summary.count)} accent="#001B40" />
        <Stat
          label={`${year} deduction`}
          value={formatCurrency(summary.totalAmount, 'CAD', { includeCode: false })}
          accent="#216E39"
        />
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">+ New entry</h2>
        {error && <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Kilometres">
            <input
              type="number"
              step="0.1"
              value={kilometres}
              onChange={(e) => setKilometres(e.target.value)}
              placeholder="32.5"
              className={inputCls + ' font-mono text-right'}
            />
          </Field>
          <Field label="From">
            <input value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} placeholder="Calgary" className={inputCls} />
          </Field>
          <Field label="To">
            <input value={toAddress} onChange={(e) => setToAddress(e.target.value)} placeholder="Edmonton" className={inputCls} />
          </Field>
          <Field label="Purpose">
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Client meeting"
              className={inputCls}
            />
          </Field>
          <div className="flex items-end">
            <button
              onClick={add}
              disabled={saving}
              className="w-full h-9 px-4 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <Field label="Vehicle (optional)">
            <input
              value={vehicleLabel}
              onChange={(e) => setVehicleLabel(e.target.value)}
              placeholder="e.g. Honda CR-V"
              className={inputCls}
            />
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB]">
          <h2 className="text-sm font-semibold text-[#001B40]">{logs.length} {logs.length === 1 ? 'entry' : 'entries'} in {year}</h2>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#576981]">No mileage logged this year.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">From → To</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Purpose</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">km</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Rate</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Amount</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-[#E1E6EB]">
                    <td className="px-3 py-2 text-[#001B40] whitespace-nowrap">{formatDate(l.date)}</td>
                    <td className="px-3 py-2 text-[#001B40] truncate max-w-[280px]">
                      {l.fromAddress || '—'} → {l.toAddress || '—'}
                      {l.vehicleLabel && <div className="text-xs text-[#576981]">{l.vehicleLabel}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#576981]">{l.purpose || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.kilometres.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-xs text-[#576981]">${l.ratePerKm.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[#001B40]">
                      {formatCurrency(l.amount, 'CAD', { includeCode: false })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => remove(l.id)} className="text-xs text-[#BF2600] hover:underline">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
                  <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">
                    Total {year}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{summary.totalKm.toFixed(2)}</td>
                  <td />
                  <td className="px-3 py-2 text-right font-mono font-bold text-[#001B40]">
                    {formatCurrency(summary.totalAmount, 'CAD', { includeCode: false })}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#576981] mb-1">{label}</span>
      {children}
    </label>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4">
      <div className="text-[11px] text-[#576981] uppercase">{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
    </div>
  )
}
