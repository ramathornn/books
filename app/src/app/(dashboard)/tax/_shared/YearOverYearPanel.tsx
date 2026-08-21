'use client'

import Link from 'next/link'

import { money2 } from '@/lib/tax/round'
import type { SlipType } from '@/lib/tax/descriptors/registry'

/**
 * Year-over-year comparison panel, shared by the T5/T4A summary pages. Renders
 * the per-box totals for the selected year plus the prior lookback years (each
 * computed live from the effective slips by `yearOverYear` in summary.ts). Rows
 * key on the tax year; prior years link back to their own summary.
 *
 * Labels come from the snapshot-backed totals so an archived/renamed recipient
 * never changes a historical column (design finding #9).
 */

interface BoxCol {
  key: string
  officialNumber: string
  label: string
}

export interface YearRow {
  taxYear: number
  totalRecipients: number
  totals: Record<string, number>
  isCurrent: boolean
}

export default function YearOverYearPanel({
  type,
  boxes,
  rows,
}: {
  type: SlipType
  boxes: BoxCol[]
  rows: YearRow[]
}) {
  const lower = type.toLowerCase()
  return (
    <div>
      <h2 className="text-lg font-medium text-[#001B40] mb-2">Year over year</h2>
      <div className="rounded-lg border border-[#D9E1EC] bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#D9E1EC] text-left text-[#576981]">
              <th className="px-3 py-2 font-medium">Year</th>
              <th className="px-3 py-2 font-medium text-right">Recipients</th>
              {boxes.map((b) => (
                <th key={b.key} className="px-3 py-2 font-medium text-right whitespace-nowrap" title={b.label}>
                  Box {b.officialNumber}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.taxYear}
                className={`border-b border-[#EEF2F7] last:border-0 ${row.isCurrent ? 'bg-[#F0F7FF]' : ''}`}
              >
                <td className="px-3 py-2 text-[#001B40]">
                  {row.isCurrent ? (
                    <span className="font-medium">{row.taxYear}</span>
                  ) : (
                    <Link
                      href={`/tax/${lower}/summary/${row.taxYear}`}
                      className="text-[#0075DD] hover:underline"
                    >
                      {row.taxYear}
                    </Link>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-[#001B40]">{row.totalRecipients}</td>
                {boxes.map((b) => (
                  <td key={b.key} className="px-3 py-2 text-right tabular-nums text-[#001B40]">
                    {row.totals[b.key] !== undefined ? money2(row.totals[b.key]) : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
