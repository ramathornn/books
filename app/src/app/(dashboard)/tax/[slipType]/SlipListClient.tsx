'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { money2 } from '@/lib/tax/round'
import type { SlipType } from '@/lib/tax/descriptors/registry'
import YearNavigator from '../_shared/YearNavigator'
import SlipStatusBadge from '../_shared/SlipStatusBadge'

interface BoxCol {
  key: string
  officialNumber: string
  label: string
}

interface SlipRow {
  id: string
  slipNumber: string | null
  status: string
  reportCode: string
  amendmentSeq: number
  isEffective: boolean
  recipientName: string
  recipientIdMasked: string
  boxes: Record<string, number>
}

interface Props {
  type: SlipType
  taxYear: number
  boxes: BoxCol[]
  slips: SlipRow[]
}

/**
 * Slip list / landing for a type+year (T5 or T4A). Lists every slip row (with
 * amendments dimmed when superseded), and links to the Summary + File flows and
 * the new-slip form. Descriptor-driven box columns so it serves both types.
 */
export default function SlipListClient({ type, taxYear, boxes, slips }: Props) {
  const router = useRouter()
  const lower = type.toLowerCase()

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <YearNavigator basePath={`/tax/${lower}`} taxYear={taxYear} />
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/tax/${lower}/summary/${taxYear}`}
            className="px-3 py-1.5 rounded border border-[#D9E1EC] text-[#576981] hover:bg-[#F4F7FB]"
          >
            Summary
          </Link>
          <Link
            href={`/tax/${lower}/file/${taxYear}`}
            className="px-3 py-1.5 rounded border border-[#D9E1EC] text-[#576981] hover:bg-[#F4F7FB]"
          >
            File return
          </Link>
          <Link
            href={`/tax/${lower}/new?year=${taxYear}`}
            className="px-3 py-1.5 rounded bg-[#0075DD] text-white hover:bg-[#0063BD]"
          >
            New {type} slip
          </Link>
        </div>
      </div>

      {slips.length === 0 ? (
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-10 text-center text-sm text-[#576981]">
          No {type} slips for {taxYear} yet.{' '}
          <Link href={`/tax/${lower}/new?year=${taxYear}`} className="text-[#0075DD] hover:underline">
            Create the first one
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#E5EAF1] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E5EAF1] text-left text-[#576981]">
                <th className="px-4 py-2 font-medium">Slip</th>
                <th className="px-4 py-2 font-medium">Recipient</th>
                {boxes.map((b) => (
                  <th key={b.key} className="px-4 py-2 font-medium text-right whitespace-nowrap" title={b.label}>
                    Box {b.officialNumber}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/tax/${lower}/${s.id}/view`)}
                  className={`border-b border-[#F1F4F8] cursor-pointer hover:bg-[#F8FAFC] ${
                    s.isEffective ? '' : 'opacity-50'
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-[#001B40]">
                    {s.slipNumber ?? 'draft'}
                    {s.amendmentSeq > 0 ? <span className="text-[#576981]"> ·{s.amendmentSeq}</span> : null}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-[#001B40]">{s.recipientName}</div>
                    <div className="text-xs text-[#8595A8]">{s.recipientIdMasked}</div>
                  </td>
                  {boxes.map((b) => (
                    <td key={b.key} className="px-4 py-2 text-right tabular-nums text-[#001B40]">
                      {s.boxes[b.key] !== undefined ? money2(s.boxes[b.key]) : '—'}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <SlipStatusBadge status={s.status} reportCode={s.reportCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
