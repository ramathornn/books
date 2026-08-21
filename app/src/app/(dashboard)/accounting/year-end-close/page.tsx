export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import YearEndCloseClient from './YearEndCloseClient'

export const metadata: Metadata = { title: 'Year-End Close' }

export default function YearEndClosePage() {
  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting" className="text-[#0075DD] hover:underline">← Accounting</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Year-End Close
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Preview your net income for a fiscal year, then post the closing entries that zero every income
          &amp; expense account into <strong>Retained Earnings</strong>. Committing also locks the books
          through Dec 31 of that year. Nothing posts until you explicitly confirm.
        </p>
      </div>

      <YearEndCloseClient />
    </div>
  )
}
