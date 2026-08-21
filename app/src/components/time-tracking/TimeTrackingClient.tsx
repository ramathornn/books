'use client'

import { useState, useCallback } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import TimerModal from './TimerModal'
import DayView from './DayView'
import WeekView from './WeekView'
import AllView from './AllView'

interface Option { id: string; name: string }
interface ProjectOpt extends Option { clientId: string | null; hourlyRate: number | null }
interface ServiceOpt extends Option { hourlyRate: number | null }

interface Props {
  initialView: string
  initialDate?: string
  clients: Option[]
  projects: ProjectOpt[]
  services: ServiceOpt[]
  teamMembers: Option[]
  companyName: string
}

const TABS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
]

export default function TimeTrackingClient({
  initialView,
  initialDate,
  clients,
  projects,
  services,
  teamMembers,
  companyName,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  // Re-derive `view` when the initialView prop changes (e.g. user clicks tab)
  const [view, setView] = useState(initialView)
  const [lastInit, setLastInit] = useState(initialView)
  if (initialView !== lastInit) {
    setLastInit(initialView)
    setView(initialView)
  }
  const [date, setDate] = useState(initialDate || new Date().toISOString().slice(0, 10))
  const [showTimer, setShowTimer] = useState(false)
  const [showBanner, setShowBanner] = useState(true)

  const setParam = useCallback(
    (name: string, value: string) => {
      const p = new URLSearchParams(searchParams.toString())
      if (value) p.set(name, value)
      else p.delete(name)
      router.push(`${pathname}?${p.toString()}`, { scroll: false })
    },
    [pathname, router, searchParams]
  )

  function changeView(v: string) {
    setView(v)
    setParam('view', v)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Time Tracking
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowTimer(true)}
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4 text-[#2FA84F]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Start Timer
          </button>
        </div>
      </div>

      {showBanner && (
        <div className="bg-[#E3F0FF] border border-[#0075DD]/20 rounded-lg p-4 mb-6 relative">
          <button
            onClick={() => setShowBanner(false)}
            className="absolute top-2 right-2 text-[#576981] hover:text-[#001B40]"
          >
            ✕
          </button>
          <h2 className="text-lg font-semibold text-[#001B40] mb-2">
            Track Time and Never Lose Another Billable Minute
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-semibold text-[#001B40]">Get Paid for All Your Time</div>
              <p className="text-[#576981]">Track with timer or manual logging</p>
            </div>
            <div>
              <div className="font-semibold text-[#001B40]">Convert Time into Invoices</div>
              <p className="text-[#576981]">Accurately bill clients</p>
            </div>
            <div>
              <div className="font-semibold text-[#001B40]">Track Everything for Everyone</div>
              <p className="text-[#576981]">Monitor team billable hours</p>
            </div>
          </div>
        </div>
      )}

      <div className="border-b border-[#E1E6EB] mb-4">
        <div className="flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => changeView(tab.value)}
              className={`px-1 pb-2 text-sm font-medium border-b-2 -mb-px ${
                view === tab.value
                  ? 'text-[#001B40] border-[#0075DD]'
                  : 'text-[#576981] border-transparent hover:text-[#001B40]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'day' && (
        <DayView
          date={date}
          setDate={setDate}
          clients={clients}
          projects={projects}
          services={services}
          teamMembers={teamMembers}
          companyName={companyName}
        />
      )}
      {view === 'week' && (
        <WeekView
          date={date}
          setDate={setDate}
          clients={clients}
          projects={projects}
          services={services}
        />
      )}
      {view === 'month' && (
        <AllView
          rangeLabel="This Month"
          clients={clients}
          projects={projects}
          services={services}
        />
      )}
      {view === 'all' && (
        <AllView
          rangeLabel="All Time"
          clients={clients}
          projects={projects}
          services={services}
        />
      )}

      {showTimer && (
        <TimerModal
          onClose={() => setShowTimer(false)}
          clients={clients}
          projects={projects}
          services={services}
          onSaved={() => {
            setShowTimer(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
