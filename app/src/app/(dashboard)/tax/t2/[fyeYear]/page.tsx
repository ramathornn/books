export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import YearNavigator from '@/app/(dashboard)/tax/_shared/YearNavigator'
import T2BuilderClient from './T2BuilderClient'

export const metadata: Metadata = { title: 'T2 Return' }

/**
 * T2 builder (draft) — the guided default path (GIFI-map pre-flight → Schedule 1
 * → review) with full schedule tabs behind toggles. A pinned federal Part I /
 * Alberta tax summary rail recomputes LIVE client-side. A prepared return
 * redirects to the read-only /view.
 */
export default async function T2BuilderPage({
  params,
}: {
  params: Promise<{ fyeYear: string }>
}) {
  const { fyeYear: raw } = await params
  const fyeYear = parseInt(raw, 10)
  if (!Number.isFinite(fyeYear) || fyeYear < 2000 || fyeYear > 2100) notFound()

  const fiscalYearEnd = new Date(Date.UTC(fyeYear, 11, 31))
  const company = await getCompanySettings()

  // A prepared return → read-only view.
  const existing = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
    select: { status: true },
  })
  if (existing?.status === 'prepared') {
    redirect(`/tax/t2/${fyeYear}/view`)
  }

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/tax/t2" className="text-[#0075DD] hover:underline">
          ← Corporate Tax (T2)
        </Link>
      </div>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            T2 — FYE Dec 31, {fyeYear}
          </h1>
          <p className="text-sm text-[#576981] mt-1">{company.legalName || 'Your corporation'}</p>
        </div>
        <YearNavigator basePath="/tax/t2" taxYear={fyeYear} segment minYear={2018} />
      </div>

      <T2BuilderClient fyeYear={fyeYear} />
    </div>
  )
}
