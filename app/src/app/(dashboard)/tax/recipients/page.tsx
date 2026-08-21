export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'

import prisma from '@/lib/prisma'
import RecipientsClient, { type RecipientVM } from './RecipientsClient'

export const metadata: Metadata = { title: 'Tax Recipients' }

/**
 * Recipient directory for the information-return slips (TaxParty). SINs are
 * stored encrypted; only `sinLast3` is surfaced for masking. Recipients can be
 * linked to an existing Client / Vendor so the T4A auto-pull can resolve the
 * contractor-flagged vendor.
 */
export default async function RecipientsPage() {
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
      addressLine1: true,
      addressLine2: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
      vendorId: true,
      vendor: { select: { isContractor: true } },
    },
    orderBy: [{ businessName: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
  })

  const recipients: RecipientVM[] = parties.map((p) => ({
    id: p.id,
    kind: p.kind as 'individual' | 'business',
    firstName: p.firstName,
    lastName: p.lastName,
    businessName: p.businessName,
    sinLast3: p.sinLast3,
    businessNumber: p.businessNumber,
    addressLine1: p.addressLine1,
    addressLine2: p.addressLine2,
    city: p.city,
    province: p.province,
    postalCode: p.postalCode,
    country: p.country,
    vendorLinked: !!p.vendorId,
    isContractor: !!p.vendor?.isContractor,
  }))

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/tax" className="text-[#0075DD] hover:underline">
          ← Tax
        </Link>
      </div>
      <h1
        className="text-[28px] sm:text-[40px] font-medium text-[#001B40] mb-1"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Recipients
      </h1>
      <p className="text-sm text-[#576981] mb-6">
        Slip recipients for T5 / T4A. SINs are encrypted at rest (AES-GCM); only the last three digits are
        shown.
      </p>

      <RecipientsClient initial={recipients} />
    </div>
  )
}
