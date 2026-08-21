'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'

interface Category {
  id: string
  name: string
  groupName: string
}

interface Client {
  id: string
  name: string
}

interface Props {
  categories: Category[]
  clients: Client[]
  currentStatus: string
  currentCategoryId: string
  currentClientId: string
  currentFrom: string
  currentTo: string
}

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'billable', label: 'Billable' },
  { value: 'non-billable', label: 'Non-Billable' },
  { value: 'pending', label: 'Pending' },
  { value: 'invoiced', label: 'Invoiced' },
]

export default function ExpenseFilterPanel({
  categories,
  clients,
  currentStatus,
  currentCategoryId,
  currentClientId,
  currentFrom,
  currentTo,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState(currentStatus)
  const [categoryId, setCategoryId] = useState(currentCategoryId)
  const [clientId, setClientId] = useState(currentClientId)
  const [from, setFrom] = useState(currentFrom)
  const [to, setTo] = useState(currentTo)

  function apply() {
    const p = new URLSearchParams(searchParams.toString())
    const setOrDelete = (k: string, v: string) => (v ? p.set(k, v) : p.delete(k))
    setOrDelete('status', status)
    setOrDelete('categoryId', categoryId)
    setOrDelete('clientId', clientId)
    setOrDelete('from', from)
    setOrDelete('to', to)
    p.set('page', '1')
    router.push(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function reset() {
    setStatus('')
    setCategoryId('')
    setClientId('')
    setFrom('')
    setTo('')
    router.push(pathname)
  }

  // Group categories by group name for the select
  const groupedCats = categories.reduce((acc, c) => {
    if (!acc[c.groupName]) acc[c.groupName] = []
    acc[c.groupName].push(c)
    return acc
  }, {} as Record<string, Category[]>)

  return (
    <aside className="bg-white rounded-lg border border-[#E1E6EB] p-4 h-fit sticky top-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#001B40]">Filters</h3>
        <button onClick={reset} className="text-xs text-[#0075DD] hover:underline">
          Reset all
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            <option value="">All Categories</option>
            {Object.entries(groupedCats).map(([group, cats]) => (
              <optgroup key={group} label={group}>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">Client</label>
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            <option value="">All Clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">From Date</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">To Date</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
        </div>

        <button
          onClick={apply}
          className="w-full bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium py-2 rounded"
        >
          Apply
        </button>
      </div>
    </aside>
  )
}
