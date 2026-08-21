export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import FxRevaluationClient from './FxRevaluationClient'

export const metadata: Metadata = { title: 'FX Revaluation' }

export default function FxRevaluationPage() {
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
          Unrealized FX Revaluation
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Compute the unrealized currency gain/loss on your non-CAD GL accounts at a snapshot date and post
          it as a balanced JE to <strong>Unrealized Currency Gains</strong>.
        </p>
      </div>

      <FxRevaluationClient />
    </div>
  )
}
