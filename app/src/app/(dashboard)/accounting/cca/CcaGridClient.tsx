'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface ComputedYear {
  taxYear: number
  classId: string
  classNumber: string
  locked: boolean
  status: string
  isCatchUp: boolean
  journalEntryId: string | null
  openingUcc: number
  additions: number
  dispositions: number
  ccaRate: number
  ccaClaimed: number
  closingUcc: number
  method: string
  recapture: boolean
  terminalLossPossible: boolean
}

interface ClassSchedule {
  class: {
    id: string
    classNumber: string
    description: string
    rate: number
    expenseAccountId: string | null
    accumDepAccountId: string | null
  }
  years: ComputedYear[]
}

const money = (n: number) => formatCurrency(n, 'CAD', { includeCode: false })

export default function CcaGridClient() {
  const [schedules, setSchedules] = useState<ClassSchedule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [through, setThrough] = useState<number>(new Date().getFullYear())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/cca/schedule?through=${through}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setSchedules(d.classes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [through])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="text-sm text-[#576981]">Loading CCA schedule…</div>
  if (error) return <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>

  if (schedules.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-12 text-center">
        <p className="text-sm text-[#576981] mb-4">
          No CCA classes yet. Set up your classes (8, 10, 50, …) then seed each one&apos;s opening UCC.
        </p>
        <Link
          href="/accounting/cca/setup"
          className="inline-block px-5 py-2 bg-[#0075DD] hover:bg-[#005FB3] text-white text-sm font-medium rounded"
        >
          Setup classes
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[#576981]">Show through year</span>
        <input
          type="number"
          value={through}
          onChange={(e) => setThrough(parseInt(e.target.value, 10) || through)}
          className="h-8 w-24 px-2 border border-[#E1E6EB] rounded font-mono text-right"
        />
      </div>

      {schedules.map((s) => (
        <div key={s.class.id} className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E1E6EB] flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#001B40]">
              Class {s.class.classNumber}
              <span className="ml-2 font-normal text-[#576981]">{s.class.description}</span>
              <span className="ml-2 font-mono text-xs text-[#576981]">{(s.class.rate * 100).toFixed(2)}%</span>
            </h2>
            <div className="flex items-center gap-3 text-xs">
              {(!s.class.expenseAccountId || !s.class.accumDepAccountId) && (
                <span className="text-[#BF2600]">⚠ accounts not configured</span>
              )}
              <Link href="/accounting/cca/setup" className="text-[#0075DD] hover:underline">Edit class</Link>
              <Link href={`/accounting/cca/${s.class.id}/history`} className="text-[#0075DD] hover:underline">History</Link>
            </div>
          </div>

          {s.years.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#576981]">
              No opening UCC seeded.{' '}
              <Link href="/accounting/cca/seed" className="text-[#0075DD] hover:underline">Seed now</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-[#F5F7FA]">
                  <tr>
                    {['Year', 'Opening UCC', 'Additions', 'Dispositions', 'Rate', 'CCA claimed', 'Closing UCC', 'Status', ''].map((h, i) => (
                      <th
                        key={i}
                        className={`px-3 py-2 text-xs font-semibold text-[#576981] ${i === 0 || i === 7 || i === 8 ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.years.map((y) => (
                    <tr key={y.taxYear} className={`border-t border-[#E1E6EB] ${y.locked ? 'bg-[#FAFBFC]' : ''}`}>
                      <td className="px-3 py-2 font-mono text-[#001B40]">
                        {y.taxYear}
                        {y.isCatchUp && <span className="ml-1 text-[10px] text-[#8B5A00]">catch-up</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{money(y.openingUcc)}</td>
                      <td className="px-3 py-2 text-right font-mono">{y.additions ? money(y.additions) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{y.dispositions ? money(y.dispositions) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#576981]">{(y.ccaRate * 100).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{money(y.ccaClaimed)}</td>
                      <td className={`px-3 py-2 text-right font-mono ${y.recapture ? 'text-[#BF2600]' : ''}`}>
                        {money(y.closingUcc)}
                        {y.recapture && <span className="block text-[10px] text-[#BF2600]">recapture</span>}
                        {y.terminalLossPossible && <span className="block text-[10px] text-[#8B5A00]">terminal loss?</span>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge locked={y.locked} status={y.status} posted={!!y.journalEntryId} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/accounting/cca/${y.classId}/${y.taxYear}`}
                          className="text-xs text-[#0075DD] hover:underline"
                        >
                          {y.locked ? 'View' : 'Edit'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function StatusBadge({ locked, status, posted }: { locked: boolean; status: string; posted: boolean }) {
  if (locked) return <span className="text-xs px-2 py-0.5 rounded bg-[#EEF1F4] text-[#576981]">locked</span>
  if (posted || status === 'posted') return <span className="text-xs px-2 py-0.5 rounded bg-[#E3FCEF] text-[#006644]">posted</span>
  return <span className="text-xs px-2 py-0.5 rounded bg-[#FFF7E6] text-[#8B5A00]">draft</span>
}
