export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import CcaGridClient from './CcaGridClient'

export const metadata: Metadata = { title: 'Capital Cost Allowance' }

export default function CcaPage() {
  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting" className="text-[#0075DD] hover:underline">← Accounting</Link>
      </div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Capital Cost Allowance
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            Declining-balance depreciation per CRA Schedule 8. Each open year rolls its closing UCC
            into the next year&apos;s opening; filed years stay frozen. Posting a claim books DR
            depreciation / CR accumulated amortization at fiscal year-end.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/accounting/cca/seed"
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
          >
            Seed opening UCC
          </Link>
          <Link
            href="/accounting/cca/setup"
            className="px-4 py-2 text-sm font-medium text-white bg-[#0075DD] hover:bg-[#005FB3] rounded"
          >
            Setup classes
          </Link>
        </div>
      </div>

      <CcaGridClient />
    </div>
  )
}
