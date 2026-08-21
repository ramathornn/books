'use client'

import { useState, useEffect, useRef } from 'react'

interface Option { id: string; name: string }
interface ProjectOpt extends Option { clientId: string | null; hourlyRate: number | null }
interface ServiceOpt extends Option { hourlyRate: number | null }

interface Props {
  onClose: () => void
  clients: Option[]
  projects: ProjectOpt[]
  services: ServiceOpt[]
  onSaved: () => void
}

function formatSeconds(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
}

export default function TimerModal({ onClose, clients, projects, services, onSaved }: Props) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [clientId, setClientId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [description, setDescription] = useState('')
  const [isBillable, setIsBillable] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  function start() {
    if (running) return
    setRunning(true)
    intervalRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
  }

  function pause() {
    setRunning(false)
    if (intervalRef.current) clearInterval(intervalRef.current)
  }

  function reset() {
    pause()
    setElapsed(0)
  }

  async function stop() {
    pause()
    if (elapsed < 1) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const minutes = Math.max(1, Math.round(elapsed / 60))
      await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: new Date().toISOString().slice(0, 10),
          durationMinutes: minutes,
          description,
          isBillable,
          isTimerBased: true,
          clientId: clientId || null,
          projectId: projectId || null,
          serviceId: serviceId || null,
        }),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const filteredProjects = clientId ? projects.filter((p) => p.clientId === clientId) : projects

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-[#001B40] mb-4">
          {running ? 'Timer Running' : 'Start Timer'}
        </h3>

        <div className="text-center mb-6">
          <div
            className="text-5xl font-mono font-semibold text-[#001B40] tabular-nums"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {formatSeconds(elapsed)}
          </div>
        </div>

        <div className="flex justify-center gap-3 mb-6">
          {!running ? (
            <button
              onClick={start}
              className="px-5 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              Start
            </button>
          ) : (
            <button
              onClick={pause}
              className="px-5 py-2 bg-[#FFAB00] hover:bg-[#D89600] text-white text-sm font-medium rounded"
            >
              Pause
            </button>
          )}
          <button
            onClick={stop}
            disabled={saving}
            className="px-5 py-2 bg-[#BF2600] hover:bg-[#9e1f00] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Stop & Save'}
          </button>
          <button
            onClick={reset}
            className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]"
          >
            Reset
          </button>
        </div>

        <div className="space-y-3">
          <select
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setProjectId('') }}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">Select client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">Select project</option>
            {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">Select service (optional)</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes"
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
          />
          <label className="flex items-center gap-2 text-sm text-[#001B40]">
            <input
              type="checkbox"
              checked={isBillable}
              onChange={(e) => setIsBillable(e.target.checked)}
            />
            Billable
          </label>
        </div>

        <div className="mt-6 text-right">
          <button
            onClick={onClose}
            className="text-sm text-[#576981] hover:text-[#001B40]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
