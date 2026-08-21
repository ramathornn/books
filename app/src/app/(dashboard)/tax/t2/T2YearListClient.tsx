'use client'

import { useRouter } from 'next/navigation'

import { money2 } from '@/lib/tax/round'
import SlipStatusBadge from '@/app/(dashboard)/tax/_shared/SlipStatusBadge'

export interface T2ReturnRow {
  fyeYear: number
  province: string
  status: string
  amendmentSeq: number
  federalTax: number | null
  albertaTax: number | null
  dividendRefund: number | null
  preparedAt: string | null
  updatedAt: string
}

/**
 * T2 year list: one row per fiscal year-end (Dec-31 persona), status badge, and
 * the federal Part I + Alberta tax. A "Start <year>" affordance opens a
 * not-yet-started year (the builder initialises the draft on open). A pinned
 * banner reminds the owner the app prepares & verifies but cannot file.
 */
export default function T2YearListClient({ returns }: { returns: T2ReturnRow[] }) {
  const router = useRouter()
  const currentYear = new Date().getFullYear()
  // Corporate fiscal years available (last 6 completed years, most recent first).
  const candidateYears = Array.from({ length: 6 }, (_, i) => currentYear - 1 - i)
  const byYear = new Map(returns.map((r) => [r.fyeYear, r]))

  function openYear(year: number) {
    router.push(`/tax/t2/${year}`)
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-[#CFE3F7] bg-[#EEF6FE] p-3 text-sm text-[#0B4B86]">
        This app <span className="font-medium">prepares &amp; verifies</span> — it cannot file. Re-key the federal T2
        worksheet into CRA-certified software and Net File the Alberta AT1 to Alberta TRA separately.
      </div>

      <div className="rounded-lg border border-[#E5EAF1] bg-white overflow-hidden">
        <div className="grid grid-cols-[5rem_1fr_7rem_7rem_7rem] gap-3 px-4 py-2.5 border-b border-[#E5EAF1] text-xs font-medium text-[#576981] bg-[#FBFCFE]">
          <div>FYE</div>
          <div>Status</div>
          <div className="text-right">Federal</div>
          <div className="text-right">Alberta</div>
          <div className="text-right">Action</div>
        </div>
        {candidateYears.map((year) => {
          const row = byYear.get(year)
          const fed = row?.federalTax
          const ab = row?.albertaTax
          return (
            <div
              key={year}
              className="grid grid-cols-[5rem_1fr_7rem_7rem_7rem] gap-3 items-center px-4 py-3 border-b border-[#F1F4F8] last:border-0"
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
              <div className="text-right text-sm font-mono text-[#001B40]">
                {fed != null ? money2(fed) : '—'}
              </div>
              <div className="text-right text-sm font-mono text-[#001B40]">
                {ab != null ? money2(ab) : '—'}
              </div>
              <div className="text-right">
                {row && row.status === 'prepared' ? (
                  <button
                    onClick={() => router.push(`/tax/t2/${year}/view`)}
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
        Lifecycle: draft → prepared. There is no &quot;filed&quot; status — the app prepares &amp; verifies only. To
        change a prepared return, reopen it or file an amendment.
      </p>
    </div>
  )
}
