'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

interface Vendor {
  id: string
  name: string
  displayName: string
  contactName: string
  email: string
  phone: string
  gstNumber: string
  isContractor: boolean
  defaultCategoryName: string
  expenseCount: number
}

export default function VendorsListClient({ initialVendors }: { initialVendors: Vendor[] }) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return initialVendors
    const q = search.toLowerCase()
    return initialVendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.contactName.toLowerCase().includes(q) ||
        v.email.toLowerCase().includes(q) ||
        v.defaultCategoryName.toLowerCase().includes(q)
    )
  }, [search, initialVendors])

  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-4 border-b border-[#E1E6EB]">
        <h2 className="text-sm font-semibold text-[#001B40]">
          {filtered.length} {filtered.length === 1 ? 'vendor' : 'vendors'}
        </h2>
        <div className="relative w-full sm:w-72">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search vendors"
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
          <svg
            className="w-4 h-4 text-[#8C9BAB] absolute left-2.5 top-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-sm text-[#576981] mb-4">No vendors yet.</p>
          <Link
            href="/vendors/new"
            className="inline-block border-2 border-dashed border-[#E1E6EB] rounded-lg px-8 py-6 text-sm text-[#576981] hover:border-[#0075DD] hover:text-[#0075DD]"
          >
            + New Vendor
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-[#F5F7FA]">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">
                  Vendor
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">
                  Contact
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">
                  Default Category
                </th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">
                  GST #
                </th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">
                  Expenses
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50"
                >
                  <td className="px-3 py-2.5 text-sm">
                    <Link
                      href={`/vendors/${v.id}`}
                      className="font-medium text-[#0075DD] hover:underline"
                    >
                      {v.displayName || v.name}
                    </Link>
                    {v.isContractor && (
                      <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] font-semibold text-[#001B40] bg-[#F0F4F8] rounded">
                        Contractor
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[#001B40]">
                    {v.contactName || '—'}
                    {v.email && (
                      <div className="text-xs text-[#576981] truncate max-w-[200px]">
                        {v.email}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[#576981]">
                    {v.defaultCategoryName || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[#576981] font-mono">
                    {v.gstNumber || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-right text-[#001B40]">
                    {v.expenseCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
