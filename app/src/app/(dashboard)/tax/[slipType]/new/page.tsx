export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import prisma from '@/lib/prisma'
import { boxesFor, slipTypeFromSlug } from '@/lib/tax/descriptors/registry'
import { partyDisplayName } from '@/lib/tax/slipService'
import NewSlipClient from './NewSlipClient'

export const metadata: Metadata = { title: 'New Slip' }

export default async function NewSlipPage({
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

  // Recipients. For T4A the auto-pull needs a vendor-linked, contractor-flagged
  // recipient; we surface that flag so the UI can guide the user.
  const parties = await prisma.taxParty.findMany({
    where: { isArchived: false },
    select: {
      id: true,
      kind: true,
      firstName: true,
      lastName: true,
      businessName: true,
      sinLast3: true,
      businessNumber: true,
      vendorId: true,
      vendor: { select: { isContractor: true } },
    },
    orderBy: [{ businessName: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    take: 500,
  })

  const recipients = parties.map((p) => ({
    id: p.id,
    name: partyDisplayName(p),
    idMasked: p.sinLast3 ? `•••-••-${p.sinLast3}` : p.businessNumber || '—',
    vendorLinked: !!p.vendorId,
    isContractor: !!p.vendor?.isContractor,
  }))

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href={`/tax/${type.toLowerCase()}?year=${taxYear}`} className="text-[#0075DD] hover:underline">
          ← {type} slips {taxYear}
        </Link>
      </div>
      <h1
        className="text-[28px] font-medium text-[#001B40] mb-4"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        New {type} slip · {taxYear}
      </h1>

      <NewSlipClient
        type={type}
        taxYear={taxYear}
        recipients={recipients}
        boxes={boxesFor(type).map((b) => ({ key: b.key, officialNumber: b.officialNumber, label: b.label }))}
      />
    </div>
  )
}
