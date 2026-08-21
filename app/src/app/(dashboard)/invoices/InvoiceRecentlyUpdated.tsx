'use client'

import { useState } from 'react'
import RecentDocCard from '@/components/ui/RecentDocCard'

interface RecentInvoice {
  id: string
  clientName: string
  invoiceNumber: string
  total: string
  status: string
  date: string
}

interface Props {
  invoices: RecentInvoice[]
}

export default function InvoiceRecentlyUpdated({ invoices }: Props) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const visible = invoices.filter((inv) => !hiddenIds.has(inv.id))
  if (visible.length === 0) return null

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#001B40]">
          Recently Updated
        </h2>
        <button
          onClick={() => setHiddenIds(new Set(invoices.map((i) => i.id)))}
          className="text-sm text-[#0075DD] hover:underline inline-flex items-center gap-1"
        >
          Remove
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto overscroll-x-contain -mx-4 px-4 scroll-px-4 sm:mx-0 sm:px-0 sm:scroll-px-0 sm:overflow-visible snap-x snap-proximity -mt-px pt-px pb-2 sm:mt-0 sm:pt-0 sm:pb-0 [-webkit-overflow-scrolling:touch] scrollbar-thin">
        {visible.map((inv) => (
          <div key={inv.id} className="flex-shrink-0 basis-[46%] max-w-[46%] min-w-0 sm:basis-auto sm:max-w-none sm:w-auto snap-start">
            <RecentDocCard
              href={`/invoices/${inv.id}`}
              number={inv.invoiceNumber}
              clientName={inv.clientName}
              date={inv.date}
              amount={inv.total}
              status={inv.status}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
