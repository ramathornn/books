export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import prisma from '@/lib/prisma'
import { boxesFor, slipTypeFromSlug } from '@/lib/tax/descriptors/registry'
import { effectiveSlips } from '@/lib/tax/effectiveSlips'
import { partyDisplayName } from '@/lib/tax/slipService'
import SlipListClient from './SlipListClient'

export const metadata: Metadata = { title: 'Information Slips' }

const TITLES: Record<string, { title: string; subtitle: string }> = {
  T5: { title: 'T5 — Investment Income', subtitle: 'Statement of Investment Income (dividends)' },
  T4A: {
    title: 'T4A — Other Income',
    subtitle: 'Statement of Pension, Retirement, Annuity & Other Income — incl. Box 048 fees for services',
  },
}

export default async function SlipListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slipType: string }>
  searchParams: Promise<{ year?: string }>
}) {
  const { slipType } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) notFound()

  const { year } = await searchParams
  const taxYear = parseInt(year ?? '', 10) || new Date().getFullYear() - 1

  const rows = await prisma.taxSlip.findMany({
    where: { type, taxYear },
    include: {
      party: { select: { id: true, kind: true, firstName: true, lastName: true, businessName: true, sinLast3: true } },
    },
    orderBy: [{ slipNumber: 'asc' }, { amendmentSeq: 'asc' }, { createdAt: 'asc' }],
  })

  // Effective tail per slipNumber for the list (drafts stand alone).
  const effectiveIds = new Set(
    effectiveSlips(
      rows.map((r) => ({
        id: r.id,
        type: r.type,
        taxYear: r.taxYear,
        status: r.status,
        slipNumber: r.slipNumber,
        amendmentSeq: r.amendmentSeq,
        isCancelled: r.isCancelled,
        boxes: r.boxes,
        boxesOverride: r.boxesOverride,
        partyId: r.partyId,
        recipientNameSnapshot: r.recipientNameSnapshot,
      }))
    ).map((r) => r.id)
  )

  const boxKeys = boxesFor(type)
  const meta = TITLES[type]

  const slips = rows.map((r) => {
    const boxes = (r.boxes ?? {}) as Record<string, number>
    const override = (r.boxesOverride ?? null) as Record<string, number> | null
    const eff: Record<string, number> = { ...boxes }
    if (override) for (const [k, v] of Object.entries(override)) if (v != null) eff[k] = v
    return {
      id: r.id,
      slipNumber: r.slipNumber,
      status: r.status,
      reportCode: r.reportCode,
      amendmentSeq: r.amendmentSeq,
      isEffective: effectiveIds.has(r.id),
      recipientName: r.recipientNameSnapshot || partyDisplayName(r.party),
      recipientIdMasked: r.party.sinLast3 ? `•••-••-${r.party.sinLast3}` : r.recipientBnSnapshot || '—',
      boxes: eff,
    }
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/tax" className="text-[#0075DD] hover:underline">
          ← Tax
        </Link>
      </div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {meta.title}
          </h1>
          <p className="text-sm text-[#576981] mt-1">{meta.subtitle}</p>
        </div>
      </div>

      <SlipListClient
        type={type}
        taxYear={taxYear}
        boxes={boxKeys.map((b) => ({ key: b.key, officialNumber: b.officialNumber, label: b.label }))}
        slips={slips}
      />
    </div>
  )
}
