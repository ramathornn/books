export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import ReceiptsInboxClient from './ReceiptsInboxClient'

export const metadata: Metadata = { title: 'Receipts' }

export default function ReceiptsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Receipts
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            Drag receipt PDFs or images into the inbox. Review, fill in vendor + amount, then add to books.
          </p>
        </div>
        <Link
          href="/expenses"
          className="text-sm text-[#0075DD] hover:underline"
        >
          ← Back to Expenses
        </Link>
      </div>

      <ReceiptsInboxClient />
    </div>
  )
}
