export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import type { T2Result, ValidationReport } from '@/lib/tax/t2/types'
import T2ViewClient from './T2ViewClient'

export const metadata: Metadata = { title: 'T2 Return (prepared)' }

/**
 * Read-only view of a PREPARED T2 (+ AT1) return, rendered from the frozen
 * resultSnapshot (never recomputed here). Surfaces the federal Part I + Alberta
 * tax, the dividend refund / GRIP closing, the verify report, and the "prepare &
 * verify" exit: download the two-worksheet re-key sheet, or reopen to a draft.
 */
export default async function T2ViewPage({
  params,
}: {
  params: Promise<{ fyeYear: string }>
}) {
  const { fyeYear: raw } = await params
  const fyeYear = parseInt(raw, 10)
  if (!Number.isFinite(fyeYear)) notFound()

  const fiscalYearEnd = new Date(Date.UTC(fyeYear, 11, 31))
  const company = await getCompanySettings()

  const ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) notFound()
  if (ret.status !== 'prepared') {
    redirect(`/tax/t2/${fyeYear}`)
  }

  const snap = (ret.resultSnapshot ?? null) as { result?: T2Result; report?: ValidationReport; checksum?: string } | null
  const result = snap?.result ?? null
  const report = snap?.report ?? null

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/tax/t2" className="text-[#0075DD] hover:underline">
          ← Corporate Tax (T2)
        </Link>
      </div>
      <div className="mb-5">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          T2 — FYE Dec 31, {fyeYear}
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          {company.legalName || 'Your corporation'} · prepared{' '}
          {ret.preparedAt ? new Date(ret.preparedAt).toLocaleDateString() : ''}
        </p>
      </div>

      <T2ViewClient
        fyeYear={fyeYear}
        result={result}
        report={report}
        checksum={snap?.checksum ?? null}
        engineVersion={ret.engineVersion}
      />
    </div>
  )
}
