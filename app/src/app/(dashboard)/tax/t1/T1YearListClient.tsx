'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { money2 } from '@/lib/tax/round'
import SlipStatusBadge from '@/app/(dashboard)/tax/_shared/SlipStatusBadge'

export interface FilerOption {
  id: string
  name: string
  sinMasked: string | null
}

export interface ReturnRow {
  taxYear: number
  province: string
  status: string
  amendmentSeq: number
  refund: number | null
  balanceOwing: number | null
  preparedAt: string | null
  updatedAt: string
}

/**
 * T1 year list: a filer selector (individual TaxParty) + one row per tax year
 * with its status badge and refund/owing. A "Start <year>" affordance lets the
 * user open a not-yet-started year (the builder initialises the draft on open).
 */
export default function T1YearListClient({
  filers,
  selectedPartyId,
  returns,
}: {
  filers: FilerOption[]
  selectedPartyId: string | null
  returns: ReturnRow[]
}) {
  const router = useRouter()
  const currentYear = new Date().getFullYear()
  // T1 filing years available (last 6 years, most recent first).
  const candidateYears = Array.from({ length: 6 }, (_, i) => currentYear - 1 - i)
  const byYear = new Map(returns.map((r) => [r.taxYear, r]))
  const [partyId, setPartyId] = useState(selectedPartyId ?? '')

  function selectFiler(id: string) {
    setPartyId(id)
    router.push(`/tax/t1?partyId=${id}`)
  }

  function openYear(year: number) {
    if (!partyId) return
    router.push(`/tax/t1/${year}?partyId=${partyId}`)
  }

  if (filers.length === 0) {
    return (
      <div className="rounded-lg border border-[#F3D9A8] bg-[#FFF8E8] p-4 text-sm text-[#8A6D1B] max-w-2xl">
        No individual recipients yet. Add one in{' '}
        <Link href="/tax/recipients" className="underline">
          Recipients
        </Link>{' '}
        (the T1 filer is an individual TaxParty), then return here.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Filer</label>
        <select
          value={partyId}
          onChange={(e) => selectFiler(e.target.value)}
          className="w-full max-w-md rounded-md border border-[#D9E1EC] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30"
        >
          {filers.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.sinMasked ? ` — ${f.sinMasked}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-lg border border-[#E5EAF1] bg-white overflow-hidden">
        <div className="grid grid-cols-[5rem_1fr_8rem_8rem] gap-3 px-4 py-2.5 border-b border-[#E5EAF1] text-xs font-medium text-[#576981] bg-[#FBFCFE]">
          <div>Year</div>
          <div>Status</div>
          <div className="text-right">Refund / owing</div>
          <div className="text-right">Action</div>
        </div>
        {candidateYears.map((year) => {
          const row = byYear.get(year)
          const refundOwing = row
            ? row.balanceOwing && row.balanceOwing > 0
              ? { label: `Owing ${money2(row.balanceOwing)}`, cls: 'text-[#9B2C2C]' }
              : row.refund && row.refund > 0
                ? { label: `Refund ${money2(row.refund)}`, cls: 'text-[#256A3A]' }
                : { label: '—', cls: 'text-[#8595A8]' }
            : { label: '—', cls: 'text-[#8595A8]' }
          return (
            <div
              key={year}
              className="grid grid-cols-[5rem_1fr_8rem_8rem] gap-3 items-center px-4 py-3 border-b border-[#F1F4F8] last:border-0"
            >
              <div className="font-mono text-sm text-[#001B40]">{year}</div>
              <div>
                {row ? (
                  <SlipStatusBadge status={row.status === 'prepared' ? 'filed' : 'draft'} />
                ) : (
                  <span className="text-xs text-[#8595A8]">Not started</span>
                )}
                {row && row.status === 'prepared' ? (
                  <span className="ml-2 text-xs text-[#8595A8]">prepared</span>
                ) : null}
              </div>
              <div className={`text-right text-sm font-mono ${refundOwing.cls}`}>{refundOwing.label}</div>
              <div className="text-right">
                {row && row.status === 'prepared' ? (
                  <button
                    onClick={() => router.push(`/tax/t1/${year}/view?partyId=${partyId}`)}
                    className="px-3 py-1.5 rounded-md border border-[#D9E1EC] text-sm text-[#0075DD] hover:bg-[#F4F7FB]"
                  >
                    View
                  </button>
                ) : (
                  <button
                    onClick={() => openYear(year)}
                    className="px-3 py-1.5 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD]"
                  >
                    {row ? 'Continue' : 'Start'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-[#8595A8]">
        Lifecycle: draft → prepared. There is no &quot;filed&quot; status — the app prepares &amp; verifies only.
        To change a prepared return, reopen it or file an amendment.
      </p>
    </div>
  )
}
