'use client'

import { useEffect, useState } from 'react'
import { formatDate } from '@/lib/utils'

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
  rangeLabel: string
  clients?: Option[]
  projects?: ProjectOpt[]
  services?: ServiceOpt[]
}

function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

function clientName(c: TimeEntry['client']): string {
  if (!c) return 'No Client'
  return c.organization || `${c.firstName} ${c.lastName}`.trim()
}

export default function AllView({ rangeLabel }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    let url = '/api/time-entries'
    if (rangeLabel === 'This Month') {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
      url += `?from=${start}&to=${end}`
    }
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setEntries(d.data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [rangeLabel])

  const total = entries.reduce((s, e) => s + e.durationMinutes, 0)
  const billable = entries.filter((e) => e.isBillable).reduce((s, e) => s + e.durationMinutes, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-lg font-semibold text-[#001B40]">{rangeLabel}</div>
        <div className="text-sm text-[#576981]">
          Total: <span className="font-semibold text-[#001B40]">{fmtMinutes(total)}</span>
          <span className="mx-2">·</span>
          Billable: <span className="font-semibold text-[#006644]">{fmtMinutes(billable)}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981]">Date</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981]">Client / Project / Service</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981]">Description</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-[#576981]">Time</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981] w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-8 text-center text-[#576981] text-sm">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={5} className="py-8 text-center text-[#576981] text-sm">No time entries.</td></tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t border-[#E1E6EB]">
                  <td className="px-4 py-2.5 text-sm text-[#001B40]">{formatDate(e.date)}</td>
                  <td className="px-4 py-2.5 text-sm">
                    <div className="text-[#001B40] font-medium">{clientName(e.client)}</div>
                    <div className="text-xs text-[#576981]">
                      {[e.project?.name, e.service?.name].filter(Boolean).join(' / ')}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-sm text-[#576981] max-w-[300px] truncate">{e.description}</td>
                  <td className="px-4 py-2.5 text-sm text-[#001B40] text-right font-semibold">
                    {fmtMinutes(e.durationMinutes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className="inline-block px-2 py-0.5 text-[11px] rounded"
                      style={{
                        backgroundColor: e.isBillable ? '#E3FCEF' : '#F5F7FA',
                        color: e.isBillable ? '#006644' : '#576981',
                      }}
                    >
                      {e.isBillable ? 'Billable' : 'Non-Billable'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
