'use client'

import { useEffect, useState } from 'react'
import TimeEntryForm from './TimeEntryForm'
import { useConfirm } from '@/components/ui/ConfirmDialog'

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
  teamMember: { id: string; firstName: string; lastName: string } | null
}

interface Props {
  date: string
  setDate: (d: string) => void
  clients: Option[]
  projects: ProjectOpt[]
  services: ServiceOpt[]
  teamMembers: Option[]
  companyName: string
}

function fmtDuration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${m.toString().padStart(2, '0')}`
}

function clientName(c: TimeEntry['client']): string {
  if (!c) return 'No Client'
  return c.organization || `${c.firstName} ${c.lastName}`.trim()
}

function weekDates(center: Date): Date[] {
  const day = center.getDay()
  const sun = new Date(center)
  sun.setDate(sun.getDate() - day)
  const out: Date[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(sun)
    d.setDate(sun.getDate() + i)
    out.push(d)
  }
  return out
}

export default function DayView({ date, setDate, clients, projects, services, teamMembers, companyName }: Props) {
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [teamMemberFilter, setTeamMemberFilter] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const { confirm, dialog } = useConfirm()

  function load() {
    setRefreshKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const p = new URLSearchParams({ date })
    if (teamMemberFilter) p.set('teamMemberId', teamMemberFilter)
    fetch(`/api/time-entries?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setEntries(d.data || [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [date, teamMemberFilter, refreshKey])

  const total = entries.reduce((s, e) => s + e.durationMinutes, 0)
  const currentDate = new Date(date)
  const week = weekDates(currentDate)
  const dateLabel = currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  function shiftDay(delta: number) {
    const d = new Date(date)
    d.setDate(d.getDate() + delta)
    setDate(d.toISOString().slice(0, 10))
  }

  return (
    <div>
      {dialog}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => shiftDay(-1)}
            className="p-1.5 text-[#576981] hover:text-[#001B40]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="text-lg font-semibold text-[#001B40]">{dateLabel}</div>
          <button
            onClick={() => shiftDay(1)}
            className="p-1.5 text-[#576981] hover:text-[#001B40]"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-2 py-1 text-sm border border-[#E1E6EB] rounded"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#576981]">Hours logged by</span>
          <select
            value={teamMemberFilter}
            onChange={(e) => setTeamMemberFilter(e.target.value)}
            className="px-2 py-1 text-sm border border-[#E1E6EB] rounded"
          >
            <option value="">{companyName}</option>
            {teamMembers.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 mb-4">
        <div className="grid grid-cols-8 gap-2 text-center text-xs">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
            const dayDate = week[i]
            const isCurrent = dayDate.toISOString().slice(0, 10) === date
            return (
              <button
                key={d}
                onClick={() => setDate(dayDate.toISOString().slice(0, 10))}
                className={`flex flex-col items-center py-2 rounded ${
                  isCurrent ? 'bg-[#0075DD] text-white' : 'text-[#576981] hover:bg-[#F5F7FA]'
                }`}
              >
                <div className="font-semibold">{d}</div>
                <div className="text-sm mt-1">{dayDate.getDate()}</div>
                <div className="text-[11px] mt-0.5">—</div>
              </button>
            )
          })}
          <div className="flex flex-col items-center justify-center py-2 text-[#576981] font-semibold">
            <div className="text-xs">Total</div>
            <div className="text-sm">{fmtDuration(total)}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <table className="w-full">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981]">
                Team Member / Date
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#576981]">
                Client / Project / Service / Note
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-[#576981]">
                Time / Status
              </th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-8 text-center text-[#576981] text-sm">Loading...</td></tr>
            ) : entries.length === 0 && !showForm ? (
              <tr>
                <td colSpan={4} className="py-10 text-center">
                  <button
                    onClick={() => setShowForm(true)}
                    className="inline-block border-2 border-dashed border-[#E1E6EB] rounded-lg px-8 py-6 text-sm text-[#576981] hover:border-[#0075DD] hover:text-[#0075DD]"
                  >
                    + New Entry
                  </button>
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id} className="border-t border-[#E1E6EB]">
                  <td className="px-4 py-3 text-sm text-[#001B40]">
                    {e.teamMember ? `${e.teamMember.firstName} ${e.teamMember.lastName}`.trim() : companyName}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="text-[#001B40] font-medium">{clientName(e.client)}</div>
                    <div className="text-xs text-[#576981]">
                      {[e.project?.name, e.service?.name].filter(Boolean).join(' / ')}
                    </div>
                    {e.description && (
                      <div className="text-xs text-[#576981] mt-0.5">{e.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="text-sm font-semibold text-[#001B40]">
                      {fmtDuration(e.durationMinutes)}
                    </div>
                    <span
                      className="inline-block mt-0.5 px-2 py-0.5 text-[11px] rounded"
                      style={{
                        backgroundColor: e.isBillable ? '#E3FCEF' : '#F5F7FA',
                        color: e.isBillable ? '#006644' : '#576981',
                      }}
                    >
                      {e.isBillable ? 'Billable' : 'Non-Billable'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        confirm({
                          title: 'Delete entry',
                          message: 'Delete this entry?',
                          variant: 'danger',
                          confirmLabel: 'Delete',
                          action: async () => {
                            await fetch(`/api/time-entries/${e.id}`, { method: 'DELETE' })
                            load()
                          },
                        })
                      }}
                      className="p-1 text-[#576981] hover:text-[#BF2600]"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
            {showForm && (
              <tr className="border-t border-[#E1E6EB] bg-[#F5F7FA]/30">
                <td colSpan={4} className="p-4">
                  <TimeEntryForm
                    date={date}
                    clients={clients}
                    projects={projects}
                    services={services}
                    onSaved={() => {
                      setShowForm(false)
                      load()
                    }}
                    onCancel={() => setShowForm(false)}
                  />
                </td>
              </tr>
            )}
          </tbody>
          {entries.length > 0 && (
            <tfoot>
              <tr className="border-t border-[#E1E6EB] bg-[#F5F7FA]">
                <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-[#001B40]">
                  Daily Total
                </td>
                <td className="px-4 py-2.5 text-sm font-semibold text-[#001B40] text-right">
                  {fmtDuration(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!showForm && entries.length > 0 && (
        <div className="mt-4 flex justify-start">
          <button
            onClick={() => setShowForm(true)}
            className="text-sm text-[#0075DD] hover:underline font-medium"
          >
            + New Entry
          </button>
        </div>
      )}
    </div>
  )
}
