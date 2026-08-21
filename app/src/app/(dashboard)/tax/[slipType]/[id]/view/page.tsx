export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import prisma from '@/lib/prisma'
import { boxesFor, slipTypeFromSlug } from '@/lib/tax/descriptors/registry'
import { recipientIdMasked } from '@/lib/tax/slipService'
import SlipViewClient from './SlipViewClient'

export const metadata: Metadata = { title: 'Slip' }

export default async function SlipViewPage({
  params,
}: {
  params: Promise<{ slipType: string; id: string }>
}) {
  const { slipType, id } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) notFound()

  const slip = await prisma.taxSlip.findUnique({
    where: { id },
    include: { party: { select: { sinLast3: true } } },
  })
  if (!slip || slip.type !== type) notFound()

  const computed = (slip.boxes ?? {}) as Record<string, number>
  const override = (slip.boxesOverride ?? null) as Record<string, number> | null
  const eff: Record<string, number> = { ...computed }
  if (override) for (const [k, v] of Object.entries(override)) if (v != null) eff[k] = v

  // Drift: compare the stored boxes against a fresh source pull for the slip's
  // recorded pulledTotal (surfaced as a banner; non-blocking).
  const sourceRef = (slip.sourceRef ?? null) as { pulledTotal?: number } | null

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href={`/tax/${type.toLowerCase()}?year=${slip.taxYear}`} className="text-[#0075DD] hover:underline">
          ← {type} slips {slip.taxYear}
        </Link>
      </div>

      <SlipViewClient
        type={type}
        slip={{
          id: slip.id,
          taxYear: slip.taxYear,
          status: slip.status,
          reportCode: slip.reportCode,
          slipNumber: slip.slipNumber,
          amendmentSeq: slip.amendmentSeq,
          recipientName: slip.recipientNameSnapshot || '—',
          recipientIdMasked: recipientIdMasked({
            recipientSinCipher: slip.recipientSinCipher,
            recipientBnSnapshot: slip.recipientBnSnapshot,
            sinLast3: slip.party?.sinLast3,
          }),
          recipientAddress: slip.recipientAddressSnapshot,
          notes: slip.notes,
          boxes: eff,
          pulledTotal: sourceRef?.pulledTotal ?? null,
        }}
        boxes={boxesFor(type).map((b) => ({ key: b.key, officialNumber: b.officialNumber, label: b.label }))}
      />
    </div>
  )
}
