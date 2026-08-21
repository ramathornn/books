export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { partyDisplayName } from '@/lib/tax/slipService'
import type { T1Result, ValidationReport } from '@/lib/tax/t1/types'
import T1ViewClient from './T1ViewClient'

export const metadata: Metadata = { title: 'T1 Return (prepared)' }

/**
 * Read-only view of a PREPARED T1 return, rendered from the frozen
 * resultSnapshot (never recomputed here). Surfaces the refund/owing, the federal
 * + AB breakdown, the verify report, and the "Prepare & verify" exit:
 * download the per-slip transcription sheet, or reopen to a draft.
 */
export default async function T1ViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>
  searchParams: Promise<{ partyId?: string }>
}) {
  const { year } = await params
  const taxYear = parseInt(year, 10)
  if (!Number.isFinite(taxYear)) notFound()

  const { partyId } = await searchParams
  if (!partyId) redirect('/tax/t1')

  const ret = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
    include: { party: { select: { kind: true, firstName: true, lastName: true, businessName: true } } },
  })
  if (!ret) notFound()

  // A draft has no frozen snapshot — send the user back to the builder.
  if (ret.status !== 'prepared') {
    redirect(`/tax/t1/${taxYear}?partyId=${partyId}`)
  }

  const snap = (ret.resultSnapshot ?? null) as { result?: T1Result; report?: ValidationReport; checksum?: string } | null
  const result = snap?.result ?? null
  const report = snap?.report ?? null

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href={`/tax/t1?partyId=${partyId}`} className="text-[#0075DD] hover:underline">
          ← Personal Tax (T1)
        </Link>
      </div>
      <div className="mb-5">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          T1 — {taxYear}
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          {partyDisplayName(ret.party)} · {ret.province} · prepared
          {ret.preparedAt ? ` ${ret.preparedAt.toISOString().slice(0, 10)}` : ''}
        </p>
      </div>

      <T1ViewClient
        taxYear={taxYear}
        partyId={partyId}
        province={ret.province}
        result={result}
        report={report}
        checksum={snap?.checksum ?? null}
        engineVersion={ret.engineVersion}
      />
    </div>
  )
}
