export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'

import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import T2YearListClient, { type T2ReturnRow } from './T2YearListClient'

export const metadata: Metadata = { title: 'Corporate Tax (T2)' }

/**
 * T2 landing — one row per FISCAL YEAR (the corporation is the singleton filer),
 * each with its status badge + federal Part I / Alberta tax. v1 scope: an
 * owner-managed Alberta CCPC, Dec-31 fiscal year-end, full 12-month years, active
 * business income, single shareholder paid via the corporation's own dividends.
 * The app PREPARES & VERIFIES the federal T2 + the Alberta AT1; it can NEVER
 * transmit — the owner re-keys the two worksheets into certified software (and
 * Net Files the AT1 to Alberta TRA separately).
 */
export default async function T2HomePage() {
  const company = await getCompanySettings()

  const rows = await prisma.t2Return.findMany({
    where: { status: { not: 'superseded' } },
    select: {
      fiscalYearEnd: true,
      taxationYear: true,
      provinceSnapshot: true,
      status: true,
      amendmentSeq: true,
      resultSnapshot: true,
      preparedAt: true,
      updatedAt: true,
    },
    orderBy: { fiscalYearEnd: 'desc' },
  })

  const returns: T2ReturnRow[] = rows.map((r) => {
    const snap = (r.resultSnapshot ?? null) as {
      result?: { federal?: { partOneTax?: number; dividendRefund?: number }; alberta?: { albertaTaxPayable?: number } }
    } | null
    const result = snap?.result ?? null
    return {
      fyeYear: r.taxationYear,
      province: r.provinceSnapshot,
      status: r.status,
      amendmentSeq: r.amendmentSeq,
      federalTax: result?.federal?.partOneTax ?? null,
      albertaTax: result?.alberta?.albertaTaxPayable ?? null,
      dividendRefund: result?.federal?.dividendRefund ?? null,
      preparedAt: r.preparedAt ? r.preparedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
    }
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/tax" className="text-[#0075DD] hover:underline">
          ← Tax
        </Link>
      </div>
      <div className="mb-5">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Corporate Tax (T2)
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Prepare &amp; verify the federal T2 + the Alberta AT1 for {company.legalName || 'your corporation'} from
          your books. {' '}
          <span className="text-[#001B40]">This app cannot file</span> — it produces a two-worksheet re-key sheet you
          transcribe into certified software; the AT1 is Net Filed to Alberta TRA separately.
        </p>
      </div>

      <T2YearListClient returns={returns} />
    </div>
  )
}
