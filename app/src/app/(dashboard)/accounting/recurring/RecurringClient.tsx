'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { describeInterval, type IntervalUnit } from '@/lib/recurring'

interface Template {
  id: string
  templateName: string
  transactionType: string
  intervalUnit: string
  intervalCount: number
  mode: string
  startDate: string
  endDate: string | null
  nextRunDate: string | null
  previousRunDate: string | null
  isActive: boolean
  runCount: number
  notes: string
}

const TX_TYPES: { value: string; label: string }[] = [
  { value: 'invoice', label: 'Invoice' },
  { value: 'bill', label: 'Bill' },
  { value: 'expense', label: 'Expense' },
  { value: 'journal_entry', label: 'Journal Entry' },
]

const INTERVAL_UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
]

const MODES: { value: string; label: string }[] = [
  { value: 'reminder', label: 'Reminder' },
  { value: 'auto_create', label: 'Auto-create' },
  { value: 'unscheduled', label: 'Unscheduled' },
]

export default function RecurringClient({ initialTemplates }: { initialTemplates: Template[] }) {
  const router = useRouter()
  const [templates, setTemplates] = useState(initialTemplates)
  const [creating, setCreating] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draftType, setDraftType] = useState('expense')
  const [draftUnit, setDraftUnit] = useState<IntervalUnit>('month')
  const [draftCount, setDraftCount] = useState(1)
  const [draftMode, setDraftMode] = useState('reminder')
  const [draftStart, setDraftStart] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')

  async function create() {
    setError('')
    if (!draftName.trim()) {
      setError('Name required.')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/recurring-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: draftName,
          transactionType: draftType,
          intervalUnit: draftUnit,
          intervalCount: draftCount,
          mode: draftMode,
          startDate: draftStart,
          payload: {},
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Create failed')
      }
      const created = await res.json()
      setTemplates((prev) => [...prev, {
        ...created,
        startDate: new Date(created.startDate).toISOString(),
        endDate: created.endDate ? new Date(created.endDate).toISOString() : null,
        nextRunDate: created.nextRunDate ? new Date(created.nextRunDate).toISOString() : null,
        previousRunDate: created.previousRunDate ? new Date(created.previousRunDate).toISOString() : null,
      }])
      setDraftName('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  async function toggleActive(t: Template) {
    const res = await fetch(`/api/recurring-templates/${t.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !t.isActive }),
    })
    if (res.ok) {
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? { ...x, isActive: !t.isActive } : x)))
    }
  }

  async function runNow(t: Template) {
    if (!confirm(`Roll "${t.templateName}" forward by one ${t.intervalUnit}?`)) return
    const res = await fetch(`/api/recurring-templates/${t.id}/run`, { method: 'POST' })
    if (res.ok) router.refresh()
  }

  async function remove(t: Template) {
    if (!confirm('Delete this template?')) return
    const res = await fetch(`/api/recurring-templates/${t.id}`, { method: 'DELETE' })
    if (res.ok) {
      setTemplates((prev) => prev.filter((x) => x.id !== t.id))
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">+ New template</h2>
        {error && <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Field label="Name">
            <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Monthly software" className={inputCls} />
          </Field>
          <Field label="Type">
            <select value={draftType} onChange={(e) => setDraftType(e.target.value)} className={inputCls + ' bg-white'}>
              {TX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Every">
            <div className="flex gap-1">
              <input
                type="number"
                min={1}
                value={draftCount}
                onChange={(e) => setDraftCount(parseInt(e.target.value, 10) || 1)}
                className={inputCls + ' w-16'}
              />
              <select value={draftUnit} onChange={(e) => setDraftUnit(e.target.value as IntervalUnit)} className={inputCls + ' bg-white flex-1'}>
                {INTERVAL_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Mode">
            <select value={draftMode} onChange={(e) => setDraftMode(e.target.value)} className={inputCls + ' bg-white'}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Start date">
            <input type="date" value={draftStart} onChange={(e) => setDraftStart(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <button
              onClick={create}
              disabled={creating}
              className="w-full h-9 px-4 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB]">
          <h2 className="text-sm font-semibold text-[#001B40]">{templates.length} template{templates.length === 1 ? '' : 's'}</h2>
        </div>
        {templates.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#576981]">
            No templates yet. Create one above to start tracking recurring transactions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Type</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Interval</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Mode</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Next run</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Previous</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Runs</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Status</th>
                  <th className="w-32 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                    <td className="px-3 py-2 font-medium text-[#001B40]">{t.templateName}</td>
                    <td className="px-3 py-2 text-xs uppercase text-[#576981]">{t.transactionType.replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-xs">
                      {describeInterval(t.intervalUnit as IntervalUnit, t.intervalCount)}
                    </td>
                    <td className="px-3 py-2 text-xs">{t.mode.replace('_', '-')}</td>
                    <td className="px-3 py-2 text-xs">{t.nextRunDate ? t.nextRunDate.slice(0, 10) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{t.previousRunDate ? t.previousRunDate.slice(0, 10) : '—'}</td>
                    <td className="px-3 py-2 text-xs text-right">{t.runCount}</td>
                    <td className="px-3 py-2">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
                        style={{
                          backgroundColor: t.isActive ? '#E6F4EA' : '#F5F7FA',
                          color: t.isActive ? '#216E39' : '#576981',
                        }}
                      >
                        {t.isActive ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => runNow(t)} className="text-xs text-[#0075DD] hover:underline mr-2">
                        Run
                      </button>
                      <button onClick={() => toggleActive(t)} className="text-xs text-[#576981] hover:underline mr-2">
                        {t.isActive ? 'Pause' : 'Resume'}
                      </button>
                      <button onClick={() => remove(t)} className="text-xs text-[#BF2600] hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
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
