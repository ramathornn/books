'use client'

import Link from 'next/link'

interface Item {
  id: string
  category: string
  vendor: string
  date: string
  amount: string
}

const ACCENT_COLORS = ['#FFAB00', '#F0627E', '#B28EFA', '#4CB3FF', '#2FA84F', '#F5B844']

export default function ExpenseRecentlyUpdated({ items }: { items: Item[] }) {
  if (!items.length) return null
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-[#001B40]">Recently Updated</h2>
        <button className="text-xs text-[#576981] hover:text-[#001B40]">
          Hide recently active cards
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((item, i) => (
          <Link
            key={item.id}
            href={`/expenses/${item.id}`}
            className="relative bg-white rounded-lg border border-[#E1E6EB] px-3 pt-4 pb-3 hover:shadow-sm transition-shadow overflow-hidden"
          >
            <span
              className="absolute top-0 left-0 right-0 h-1"
              style={{ backgroundColor: ACCENT_COLORS[i % ACCENT_COLORS.length] }}
            />
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
              </svg>
              <span className="text-xs font-semibold text-[#001B40] truncate">{item.category}</span>
            </div>
            <div className="text-xs text-[#576981] truncate" title={item.vendor}>
              {item.vendor || '\u00a0'}
            </div>
            <div className="text-[11px] text-[#8C9BAB] mt-0.5">{item.date}</div>
            <div className="mt-2 text-sm font-semibold text-[#001B40]">{item.amount}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
