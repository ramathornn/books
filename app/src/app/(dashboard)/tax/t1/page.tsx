export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'

import prisma from '@/lib/prisma'
import { partyDisplayName } from '@/lib/tax/slipService'
import T1YearListClient, { type FilerOption, type ReturnRow } from './T1YearListClient'

export const metadata: Metadata = { title: 'Personal Tax (T1)' }

/**
 * T1 landing — pick the filer (an individual TaxParty), then one row per tax year
 * with its status badge + refund/owing. v1 scope: a married, full-year Alberta
 * resident CCPC owner paid via the company's own T5 dividends. The app PREPARES &
 * VERIFIES the return; it can NEVER NETFILE — the owner re-keys the per-slip
 * transcription export into certified software.
 */
export default async function T1HomePage({
  searchParams,
}: {
  searchParams: Promise<{ partyId?: string }>
}) {
  const { partyId: requestedPartyId } = await searchParams

  const parties = await prisma.taxParty.findMany({
    where: { kind: 'individual', isArchived: false },
    select: { id: true, firstName: true, lastName: true, businessName: true, kind: true, sinLast3: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  })

  const filers: FilerOption[] = parties.map((p) => ({
    id: p.id,
    name: partyDisplayName(p),
    sinMasked: p.sinLast3 ? `•••-••-${p.sinLast3}` : null,
  }))

  const selectedPartyId =
    requestedPartyId && filers.some((f) => f.id === requestedPartyId)
      ? requestedPartyId
      : filers[0]?.id ?? null

  let returns: ReturnRow[] = []
  if (selectedPartyId) {
    const rows = await prisma.t1Return.findMany({
      where: { partyId: selectedPartyId, status: { not: 'superseded' } },
      select: {
        id: true,
        taxYear: true,
        province: true,
        status: true,
        amendmentSeq: true,
        resultSnapshot: true,
        preparedAt: true,
        updatedAt: true,
      },
      orderBy: { taxYear: 'desc' },
    })

    returns = rows.map((r) => {
      const snap = (r.resultSnapshot ?? null) as { result?: { refund?: number; balanceOwing?: number } } | null
      const result = snap?.result ?? null
      return {
        taxYear: r.taxYear,
        province: r.province,
        status: r.status,
        amendmentSeq: r.amendmentSeq,
        refund: result?.refund ?? null,
        balanceOwing: result?.balanceOwing ?? null,
        preparedAt: r.preparedAt ? r.preparedAt.toISOString() : null,
        updatedAt: r.updatedAt.toISOString(),
      }
    })
  }

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/tax" className="text-[#0075DD] hover:underline">
          ← Tax
        </Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Personal Tax (T1)
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Prepare &amp; verify a personal income-tax return. This app cannot NETFILE — it produces a per-slip
          transcription sheet you re-key into certified software (Wealthsimple / TurboTax / UFile) or mail.
        </p>
      </div>

      <T1YearListClient filers={filers} selectedPartyId={selectedPartyId} returns={returns} />
    </div>
  )
}
