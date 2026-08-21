'use client'

import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import StatusBadge from '@/components/ui/StatusBadge'
import Pagination from '@/components/ui/Pagination'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Row {
  id: string
  vendor: string
  category: string
  date: string
  source: string
  clientName: string
  projectName: string
  description: string
  amount: number
  currency: string
  status: string
  receiptUrl: string
}

interface Props {
  rows: Row[]
  totalCount: number
  totalPages: number
  page: number
  perPage: number
  sortBy: string
  sortOrder: string
  search: string
}

export default function ExpenseTable({
  rows,
  totalCount,
  totalPages,
  page,
  perPage,
  sortBy,
  sortOrder,
  search,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [searchInput, setSearchInput] = useState(search)
  const { confirm, dialog } = useConfirm()

  function setParam(name: string, value: string | null) {
    const p = new URLSearchParams(searchParams.toString())
    if (value) p.set(name, value)
    else p.delete(name)
    p.set('page', '1')
    router.push(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function toggleSort() {
    const nextOrder = sortBy === 'date' && sortOrder === 'desc' ? 'asc' : 'desc'
    const p = new URLSearchParams(searchParams.toString())
    p.set('sortBy', 'date')
    p.set('sortOrder', nextOrder)
    router.push(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function handleDelete(id: string) {
    confirm({
      title: 'Delete expense',
      message: 'Delete this expense? This cannot be undone.',
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        await fetch(`/api/expenses/${id}`, { method: 'DELETE' })
        router.refresh()
      },
    })
  }

  return (
    <>
    {dialog}
    <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-[#E1E6EB]">
        <h2 className="text-sm font-semibold text-[#001B40]">All Expenses</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setParam('search', searchInput || null)}
              placeholder="Search"
              className="pl-8 pr-3 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD] w-52"
            />
            <svg className="w-4 h-4 text-[#8C9BAB] absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-12 text-center">
          <Link
            href="/expenses/new"
            className="inline-block border-2 border-dashed border-[#E1E6EB] rounded-lg px-8 py-6 text-sm text-[#576981] hover:border-[#0075DD] hover:text-[#0075DD]"
          >
            + New Expense
          </Link>
        </div>
      ) : (
        <table className="w-full">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="w-10 px-3 py-2.5 text-left">
                <input type="checkbox" className="rounded border-[#E1E6EB]" />
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">
                Vendor / Category
              </th>
              <th
                className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981] cursor-pointer"
                onClick={toggleSort}
              >
                Date {sortBy === 'date' && (sortOrder === 'asc' ? '▲' : '▼')}
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Source</th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">
                Client / Project / Description
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">
                Amount / Status
              </th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                <td className="px-3 py-2.5">
                  <input type="checkbox" className="rounded border-[#E1E6EB]" />
                </td>
                <td className="px-3 py-2.5 text-sm">
                  <div className="font-medium text-[#001B40]">{r.vendor || '—'}</div>
                  <div className="text-xs text-[#576981]">{r.category}</div>
                </td>
                <td className="px-3 py-2.5 text-sm text-[#001B40]">{formatDate(r.date)}</td>
                <td className="px-3 py-2.5 text-sm text-[#576981]">{r.source}</td>
                <td className="px-3 py-2.5 text-sm">
                  <div className="text-[#001B40] truncate max-w-[240px]">
                    {r.clientName || r.projectName || '—'}
                  </div>
                  {r.description && (
                    <div className="text-xs text-[#576981] truncate max-w-[240px]">
                      {r.description}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <div className="text-sm font-semibold text-[#001B40]">
                    {formatCurrency(r.amount, r.currency, { includeCode: false })}
                  </div>
                  <div className="mt-0.5">
                    <StatusBadge status={r.status} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1 justify-end">
                    <Link
                      href={`/expenses/${r.id}`}
                      className="p-1 text-[#576981] hover:text-[#0075DD]"
                      title="Edit"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </Link>
                    <button
                      className="p-1 text-[#576981] hover:text-[#0075DD]"
                      title="Attach receipt"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1 text-[#576981] hover:text-[#BF2600]"
                      title="Delete"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M10 3h4a1 1 0 011 1v3H9V4a1 1 0 011-1z" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="border-t border-[#E1E6EB]">
          <Pagination currentPage={page} totalPages={totalPages} perPage={perPage} totalCount={totalCount} />
        </div>
      )}
    </div>
    </>
  )
}
