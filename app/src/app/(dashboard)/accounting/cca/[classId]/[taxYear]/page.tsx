export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import CcaYearEditorClient from './CcaYearEditorClient'

export default async function CcaYearPage({
  params,
}: {
  params: Promise<{ classId: string; taxYear: string }>
}) {
  const { classId, taxYear } = await params
  const year = parseInt(taxYear, 10)
  if (!Number.isInteger(year)) return notFound()

  const cls = await prisma.ccaClass.findUnique({
    where: { id: classId },
    select: { id: true, classNumber: true, description: true, rate: true },
  })
  if (!cls) return notFound()

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting/cca" className="text-[#0075DD] hover:underline">← Capital Cost Allowance</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Class {cls.classNumber} — {year}
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          {cls.description} · {(Number(cls.rate) * 100).toFixed(2)}% declining balance. Enter additions
          and dispositions; the CCA claim and closing UCC recompute live. Posting books the annual
          journal entry at fiscal year-end.
        </p>
      </div>

      <CcaYearEditorClient classId={classId} taxYear={year} />
    </div>
  )
}
