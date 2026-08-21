'use client'

import Link from 'next/link'
import { money2 } from '@/lib/tax/round'
import type { SlipType, SummarySlipRow, SummaryDivergence, YearComparisonRow } from '@/lib/tax/summary'
import YearNavigator from '../../../_shared/YearNavigator'
import YearOverYearPanel from '../../../_shared/YearOverYearPanel'

interface BoxCol {
  key: string
  officialNumber: string
  label: string
}

interface Props {
  type: SlipType
  taxYear: number
  boxes: BoxCol[]
  summary: {
    filer: { legalName: string; bnRz: string; address: string }
    totals: Record<string, number>
    totalRecipients: number
    hasDraft: boolean
    rows: SummarySlipRow[]
  }
  divergence: SummaryDivergence
  comparison: YearComparisonRow[]
}

const TITLES: Record<SlipType, string> = {
  T5: 'T5 Summary',
  T4A: 'T4A Summary',
}
const SUBTITLES: Record<SlipType, string> = {
  T5: 'Statement of Investment Income',
  T4A: 'Statement of Pension, Retirement, Annuity & Other Income',
}

function amount(v: number | undefined): string {
  return v !== undefined ? money2(v) : '—'
}

export default function SlipSummaryClient({
  type,
  taxYear,
  boxes,
  summary,
  divergence,
  comparison,
}: Props) {
  const lower = type.toLowerCase()

  return (
    <div>
      {/* Year navigation (shared) */}
      <div className="mb-4">
        <YearNavigator basePath={`/tax/${lower}/summary`} taxYear={taxYear} segment />
      </div>

      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {TITLES[type]} — {taxYear}
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            {SUBTITLES[type]}. Live totals computed from the effective slips (latest non-cancelled
            row per slip). The stored summary is an as-filed snapshot only.
          </p>
        </div>
        <Link
          href={`/tax/${lower}/file/${taxYear}`}
          className="shrink-0 px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063bd]"
        >
          File {type} {taxYear} →
        </Link>
      </div>

      {/* Filer identity */}
      <div className="rounded-lg border border-[#D9E1EC] bg-white p-4 mb-4 text-sm">
        <div className="font-medium text-[#001B40]">{summary.filer.legalName || '— legal name not set —'}</div>
        <div className="text-[#576981]">{summary.filer.bnRz || '— BN / RZ not set —'}</div>
        <div className="text-[#576981]">{summary.filer.address}</div>
      </div>

      {/* Draft / divergence banners */}
      {summary.hasDraft ? (
        <div className="rounded-lg border border-[#F0C36D] bg-[#FFF8E8] p-3 mb-4 text-sm text-[#8A6D1B]">
          One or more slips in this year are still <strong>draft</strong>. Issue all slips before filing —
          drafts are excluded from a filed return.
        </div>
      ) : null}

      {divergence.filed ? (
        divergence.diverged ? (
          <div className="rounded-lg border border-[#F0A0A0] bg-[#FFF1F1] p-3 mb-4 text-sm text-[#9B2C2C]">
            <div className="font-medium">Live totals differ from the as-filed snapshot.</div>
            <div className="mt-1">
              This year was filed
              {divergence.filedAt ? ` on ${divergence.filedAt.slice(0, 10)}` : ''}
              {divergence.craSubmissionRef ? ` (ref ${divergence.craSubmissionRef})` : ''}. The slips
              have since changed — file an <strong>amended</strong> return to update CRA.
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
              {Object.entries(divergence.deltas).map(([k, d]) => (
                <span key={k}>
                  {k}: {d > 0 ? '+' : ''}
                  {money2(d)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-[#A8D5B5] bg-[#F0FBF3] p-3 mb-4 text-sm text-[#256A3A]">
            Filed{divergence.filedAt ? ` on ${divergence.filedAt.slice(0, 10)}` : ''}
            {divergence.craSubmissionRef ? ` (ref ${divergence.craSubmissionRef})` : ''}. Live totals
            match the as-filed snapshot.
          </div>
        )
      ) : null}

      {/* Per-recipient table */}
      <div className="rounded-lg border border-[#D9E1EC] bg-white overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#D9E1EC] text-left text-[#576981]">
              <th className="px-3 py-2 font-medium">Slip #</th>
              <th className="px-3 py-2 font-medium">Recipient</th>
              {boxes.map((b) => (
                <th key={b.key} className="px-3 py-2 font-medium text-right whitespace-nowrap" title={b.label}>
                  Box {b.officialNumber}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.length === 0 ? (
              <tr>
                <td colSpan={2 + boxes.length} className="px-3 py-6 text-center text-[#576981]">
                  No {type} slips for {taxYear}.
                </td>
              </tr>
            ) : (
              summary.rows.map((row) => (
                <tr key={row.id} className="border-b border-[#EEF2F7] last:border-0">
                  <td className="px-3 py-2 text-[#001B40]">{row.slipNumber ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="text-[#001B40]">{row.recipientName}</div>
                    <div className="text-xs text-[#94A3B8]">
                      {row.recipientIdMasked}
                      {row.status !== 'issued' && row.status !== 'filed' ? (
                        <span className="ml-2 uppercase tracking-wide">{row.status}</span>
                      ) : null}
                    </div>
                  </td>
                  {boxes.map((b) => (
                    <td key={b.key} className="px-3 py-2 text-right font-mono text-[#001B40]">
                      {amount(row.boxes[b.key])}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#D9E1EC] bg-[#F4F7FB] font-medium">
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-[#001B40]">
                Totals ({summary.totalRecipients} recipient{summary.totalRecipients === 1 ? '' : 's'})
              </td>
              {boxes.map((b) => (
                <td key={b.key} className="px-3 py-2 text-right font-mono text-[#001B40]">
                  {amount(summary.totals[b.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Year-over-year comparison (shared) */}
      <YearOverYearPanel type={type} boxes={boxes} rows={comparison} />
    </div>
  )
}
