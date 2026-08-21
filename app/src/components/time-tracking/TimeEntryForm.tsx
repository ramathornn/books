'use client'

import { useState } from 'react'

interface Option { id: string; name: string }
interface ProjectOpt extends Option { clientId: string | null; hourlyRate: number | null }
interface ServiceOpt extends Option { hourlyRate: number | null }

interface Props {
  date: string
  initialDurationMinutes?: number
  clients: Option[]
  projects: ProjectOpt[]
  services: ServiceOpt[]
  onSaved: () => void
  onCancel: () => void
}

// Parse "1:30", "1.5", "90m", "90" → minutes
function parseTime(input: string): number {
  const s = input.trim()
  if (!s) return 0
  if (s.includes(':')) {
    const [h, m] = s.split(':')
    return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0)
  }
  if (s.endsWith('m')) return parseInt(s, 10) || 0
  const n = parseFloat(s)
  if (isNaN(n)) return 0
  return Math.round(n * 60)
}

function formatMinutes(mins: number) {
  if (!mins) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

export default function TimeEntryForm({
  date,
  initialDurationMinutes = 0,
  clients,
  projects,
  services,
  onSaved,
  onCancel,
}: Props) {
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [timeInput, setTimeInput] = useState(formatMinutes(initialDurationMinutes))
  const [description, setDescription] = useState('')
  const [isBillable, setIsBillable] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const filteredProjects = clientId ? projects.filter((p) => p.clientId === clientId) : projects

  async function save() {
    setErr('')
    const minutes = parseTime(timeInput)
    if (!minutes) {
      setErr('Please enter a duration')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          durationMinutes: minutes,
          description,
          isBillable,
          clientId: clientId || null,
          projectId: projectId || null,
          serviceId: serviceId || null,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      onSaved()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {err && <div className="mb-2 text-xs text-[#BF2600]">{err}</div>}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
        <div className="md:col-span-3">
          <label className="block text-xs text-[#576981] mb-1">Client</label>
          <select
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setProjectId('') }}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">Select client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs text-[#576981] mb-1">Project</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">Select project</option>
            {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-[#576981] mb-1">Service</label>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">—</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-[#576981] mb-1">Time</label>
          <input
            type="text"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            placeholder="HH:MM or 1.5"
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          />
        </div>
        <div className="md:col-span-2 flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-[#001B40] cursor-pointer">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
            />
            Billable
          </label>
        </div>
        <div className="md:col-span-12">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add notes"
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 text-sm bg-[#038A06] hover:bg-[#026e05] text-white rounded disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm text-[#576981] hover:text-[#001B40]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
