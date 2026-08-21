export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { partyDisplayName, partyAddressLine } from '@/lib/tax/slipService'
import YearNavigator from '@/app/(dashboard)/tax/_shared/YearNavigator'
import T1BuilderClient from './T1BuilderClient'

export const metadata: Metadata = { title: 'T1 Return' }

/**
 * T1 builder (draft) — sectioned collapsible cards (Identity → Income →
 * Deductions → Taxable → Federal → Alberta → Review → Export) with a pinned
 * refund/owing summary rail recomputed LIVE client-side. A prepared return
 * redirects to the read-only /view.
 */
export default async function T1BuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>
  searchParams: Promise<{ partyId?: string }>
}) {
  const { year } = await params
  const taxYear = parseInt(year, 10)
  if (!Number.isFinite(taxYear) || taxYear < 2000 || taxYear > 2100) notFound()

  const { partyId } = await searchParams
  if (!partyId) redirect('/tax/t1')

  const party = await prisma.taxParty.findUnique({
    where: { id: partyId },
    select: {
      id: true, kind: true, firstName: true, lastName: true, businessName: true,
      sinLast3: true, sinCipher: true, dateOfBirth: true, businessNumber: true,
      addressLine1: true, addressLine2: true, city: true, province: true, postalCode: true, country: true,
    },
  })
  if (!party || party.kind !== 'individual') notFound()

  // If the effective return is already prepared, send the user to the read-only view.
  const existing = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
    select: { status: true },
  })
  if (existing?.status === 'prepared') {
    redirect(`/tax/t1/${taxYear}/view?partyId=${partyId}`)
  }

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href={`/tax/t1?partyId=${partyId}`} className="text-[#0075DD] hover:underline">
          ← Personal Tax (T1)
        </Link>
      </div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            T1 — {taxYear}
          </h1>
          <p className="text-sm text-[#576981] mt-1">{partyDisplayName(party)}</p>
        </div>
        <YearNavigator basePath="/tax/t1" taxYear={taxYear} segment minYear={2018} />
      </div>

      <T1BuilderClient
        taxYear={taxYear}
        filer={{
          id: party.id,
          name: partyDisplayName(party),
          sinMasked: party.sinLast3 ? `•••-••-${party.sinLast3}` : null,
          hasSin: !!party.sinCipher,
          dateOfBirth: party.dateOfBirth ? party.dateOfBirth.toISOString().slice(0, 10) : null,
          province: (party.province || 'AB').toUpperCase(),
          address: partyAddressLine(party),
        }}
      />
    </div>
  )
}
