export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { T5_BOXES } from '@/lib/tax/descriptors/t5'
import { T4A_BOXES } from '@/lib/tax/descriptors/t4a'
import {
  buildLiveSummary,
  summaryDivergence,
  yearOverYear,
  type SlipType,
} from '@/lib/tax/summary'
import SlipSummaryClient from './SlipSummaryClient'

export const metadata: Metadata = { title: 'Slip Summary' }

function parseType(raw: string): SlipType | null {
  const t = (raw || '').toUpperCase()
  return t === 'T5' || t === 'T4A' ? (t as SlipType) : null
}

export default async function SlipSummaryPage({
  params,
}: {
  params: Promise<{ slipType: string; year: string }>
}) {
  const { slipType, year } = await params
  const type = parseType(slipType)
  const taxYear = parseInt(year, 10)
  if (!type || !Number.isInteger(taxYear)) notFound()

  const summary = await buildLiveSummary(type, taxYear)
  const divergence = await summaryDivergence(type, taxYear, summary.totals)
  const comparison = await yearOverYear(type, taxYear, 2)

  const boxes = (type === 'T5' ? T5_BOXES : T4A_BOXES).map((b) => ({
    key: b.key,
    officialNumber: b.officialNumber,
    label: b.label,
  }))

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href={`/tax/${type.toLowerCase()}`} className="text-[#0075DD] hover:underline">
          ← {type} slips
        </Link>
      </div>

      <SlipSummaryClient
        type={type}
        taxYear={taxYear}
        boxes={boxes}
        summary={{
          filer: summary.filer,
          totals: summary.totals,
          totalRecipients: summary.totalRecipients,
          hasDraft: summary.hasDraft,
          rows: summary.rows,
        }}
        divergence={divergence}
        comparison={comparison}
      />
    </div>
  )
}
