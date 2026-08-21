'use client'

import { useEffect, useState } from 'react'

interface Option { id: string; name: string }
interface ProjectOpt extends Option { clientId: string | null; hourlyRate: number | null }
interface ServiceOpt extends Option { hourlyRate: number | null }

interface TimeEntry {
  id: string
  date: string
  durationMinutes: number
  description: string
  isBillable: boolean
  client: { id: string; firstName: string; lastName: string; organization: string } | null
  project: { id: string; name: string } | null
  service: { id: string; name: string } | null
}

interface Props {
  date: string
  setDate: (d: string) => void
  clients?: Option[]
  projects?: ProjectOpt[]
  services?: ServiceOpt[]
}

function weekBounds(dateStr: string) {
  const center = new Date(dateStr)
  const day = center.getDay()
  const sun = new Date(center)
  sun.setDate(center.getDate() - day)
  sun.setHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setDate(sun.getDate() + 6)
  sat.setHours(23, 59, 59, 999)
  const days: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sun)
    d.setDate(sun.getDate() + i)
    days.push(d)
  }
  return { sun, sat, days }
}

function fmtMinutes(mins: number) {
  if (!mins) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

function clientName(c: TimeEntry['client']): string {
  if (!c) return 'No Client'
  return c.organization || `${c.firstName} ${c.lastName}`.trim()
}

export default function WeekView({ date, setDate }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const { sun, sat, days } = weekBounds(date)
  const sunIso = sun.toISOString()
  const satIso = sat.toISOString()

  useEffect(() => {
    let cancelled = false
    fetch(`/api/time-entries?from=${sunIso}&to=${satIso}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setEntries(d.data || [])
      })
    return () => { cancelled = true }
  }, [sunIso, satIso])

  // Group entries by client/project/service key
  const rowMap = new Map<string, { clientId: string | null; projectId: string | null; serviceId: string | null; clientName: string; projectName: string; serviceName: string; perDay: number[]; entries: TimeEntry[] }>()
  for (const e of entries) {
    const key = `${e.client?.id || ''}::${e.project?.id || ''}::${e.service?.id || ''}`
    let row = rowMap.get(key)
    if (!row) {
      row = {
        clientId: e.client?.id || null,
        projectId: e.project?.id || null,
        serviceId: e.service?.id || null,
        clientName: clientName(e.client),
        projectName: e.project?.name || '',
        serviceName: e.service?.name || '',
        perDay: Array(7).fill(0),
        entries: [],
      }
      rowMap.set(key, row)
    }
    const entryDate = new Date(e.date)
    const dayIdx = entryDate.getDay()
    row.perDay[dayIdx] += e.durationMinutes
    row.entries.push(e)
  }
  const rows = Array.from(rowMap.values())

  const weekTotals = Array(7).fill(0)
  for (const r of rows) {
    for (let i = 0; i < 7; i++) weekTotals[i] += r.perDay[i]
  }
  const grandTotal = weekTotals.reduce((s, n) => s + n, 0)

  function shiftWeek(delta: number) {
    const d = new Date(date)
    d.setDate(d.getDate() + delta * 7)
    setDate(d.toISOString().slice(0, 10))
  }

  const rangeLabel = `${sun.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sat.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => shiftWeek(-1)} className="p-1.5 text-[#576981] hover:text-[#001B40]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="text-lg font-semibold text-[#001B40]">{rangeLabel}</div>
          <button onClick={() => shiftWeek(1)} className="p-1.5 text-[#576981] hover:text-[#001B40]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
        <div className="text-sm text-[#576981]">
          Total: <span className="font-semibold text-[#001B40]">{fmtMinutes(grandTotal)}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981] w-64">
                Client / Project / Service
              </th>
              {days.map((d, i) => (
                <th key={i} className="px-2 py-2.5 text-center text-xs font-semibold text-[#576981]">
                  <div>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}</div>
                  <div className="text-[11px] text-[#8C9BAB] mt-0.5">{d.getMonth() + 1}/{d.getDate()}</div>
                </th>
              ))}
              <th className="px-2 py-2.5 text-center text-xs font-semibold text-[#576981] w-20">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-sm text-[#576981]">
                  No time entries for this week. Add entries from the Day view.
                </td>
              </tr>
            ) : (
              rows.map((r, i) => {
                const rowTotal = r.perDay.reduce((s, n) => s + n, 0)
                return (
                  <tr key={i} className="border-t border-[#E1E6EB]">
                    <td className="px-4 py-2.5 text-sm">
                      <div className="text-[#001B40] font-medium">{r.clientName}</div>
                      <div className="text-xs text-[#576981]">
                        {[r.projectName, r.serviceName].filter(Boolean).join(' / ') || '—'}
                      </div>
                    </td>
                    {r.perDay.map((mins, di) => (
                      <td key={di} className="px-2 py-2.5 text-center text-sm text-[#001B40]">
                        {fmtMinutes(mins)}
                      </td>
                    ))}
                    <td className="px-2 py-2.5 text-center text-sm font-semibold text-[#001B40]">
                      {fmtMinutes(rowTotal)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-[#F5F7FA] border-t border-[#E1E6EB]">
                <td className="px-4 py-2.5 text-sm font-semibold text-[#001B40]">Daily Total</td>
                {weekTotals.map((t, i) => (
                  <td key={i} className="px-2 py-2.5 text-center text-sm font-semibold text-[#001B40]">
                    {fmtMinutes(t)}
                  </td>
                ))}
                <td className="px-2 py-2.5 text-center text-sm font-semibold text-[#001B40]">
                  {fmtMinutes(grandTotal)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
