'use client'

import { useState, useEffect, useCallback } from 'react'
import PrimaryButton from '@/components/ui/PrimaryButton'
import TaxRowsEditor from '@/components/ui/TaxRowsEditor'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'
import {
  ItemTax,
  parseItemTaxes,
  serializeItemTaxes,
  formatTaxList,
} from '@/lib/taxes'

interface Item {
  id: string
  name: string
  description: string
  rate: number
  taxes: string
  category: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

const PER_PAGE_OPTIONS = [25, 40, 50, 100]
const DEFAULT_PER_PAGE = 40

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'items' | 'services'>('items')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [perPage, setPerPage] = useState(DEFAULT_PER_PAGE)
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [overflowMenuId, setOverflowMenuId] = useState<string | null>(null)

  // Close the open row-actions menu on any click outside its own cell. The
  // cell is marked data-overflow-menu so the trigger's own mousedown doesn't
  // close-then-reopen via the subsequent click.
  useEffect(() => {
    if (overflowMenuId === null) return
    function onDocMouseDown(e: MouseEvent) {
      if ((e.target as HTMLElement).closest?.('[data-overflow-menu]')) return
      setOverflowMenuId(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [overflowMenuId])

  // Create/Edit form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formRate, setFormRate] = useState<number>(0)
  const [formTaxes, setFormTaxes] = useState<ItemTax[]>([
    { name: 'GST', rate: 5, enabled: true },
  ])
  const [formIncomeAccount, setFormIncomeAccount] = useState('Sales')
  const [formStock, setFormStock] = useState('')
  const [formCurrency, setFormCurrency] = useState('CAD')
  const [saving, setSaving] = useState(false)
  const { confirm, dialog } = useConfirm()

  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', currentPage.toString())
      params.set('limit', perPage.toString())
      if (search) params.set('search', search)
      if (activeTab === 'services') {
        params.set('category', 'service')
      }

      const res = await fetch(`/api/items?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data)) {
          setItems(data)
          setPagination(null)
        } else if (data.data) {
          setItems(data.data)
          setPagination(data.pagination || null)
        } else {
          setItems([])
          setPagination(null)
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [search, currentPage, activeTab, perPage])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // For the items tab, filter out services client-side if the API doesn't support category filter
  const filteredItems =
    activeTab === 'items'
      ? items.filter((item) => item.category !== 'service')
      : items

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredItems.map((item) => item.id)))
    }
  }

  const runBulk = async (action: string, ids: string[]) => {
    try {
      if (action === 'delete') {
        await Promise.all(
          ids.map((itemId) =>
            fetch(`/api/items/${itemId}`, { method: 'DELETE' })
          )
        )
      } else if (action === 'duplicate') {
        for (const itemId of ids) {
          const res = await fetch(`/api/items/${itemId}`)
          if (res.ok) {
            const item = await res.json()
            await fetch('/api/items', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: `${item.name} (Copy)`,
                description: item.description,
                rate: Number(item.rate),
                taxes: item.taxes,
                category: item.category,
              }),
            })
          }
        }
      }

      setSelectedIds(new Set())
      fetchItems()
    } catch {
      toast.error(`Failed to ${action} items`)
    }
  }

  const handleBulkAction = (action: string) => {
    if (selectedIds.size === 0) return
    const ids = Array.from(selectedIds)

    if (action === 'delete') {
      confirm({
        title: 'Delete items',
        message: `Delete ${ids.length} item(s)? This cannot be undone.`,
        variant: 'danger',
        confirmLabel: 'Delete',
        action: async () => {
          await runBulk('delete', ids)
        },
      })
      return
    }

    runBulk(action, ids)
  }

  // L8: Row action handlers
  const handleRowAction = async (action: string, item: Item) => {
    setOverflowMenuId(null)
    if (action === 'edit') {
      setEditingItem(item)
      setFormName(item.name)
      setFormDescription(item.description)
      setFormRate(Number(item.rate))
      setFormTaxes(parseItemTaxes(item.taxes))
      setFormIncomeAccount('Sales')
      setFormStock('')
      setFormCurrency('CAD')
      setShowCreateModal(true)
    } else if (action === 'duplicate') {
      try {
        await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `${item.name} (Copy)`,
            description: item.description,
            rate: Number(item.rate),
            taxes: item.taxes,
            category: item.category,
          }),
        })
        fetchItems()
      } catch {
        toast.error('Failed to duplicate item')
      }
    } else if (action === 'delete') {
      confirm({
        title: 'Delete item',
        message: `Delete "${item.name}"? This cannot be undone.`,
        variant: 'danger',
        confirmLabel: 'Delete',
        action: async () => {
          try {
            await fetch(`/api/items/${item.id}`, { method: 'DELETE' })
            fetchItems()
          } catch {
            toast.error('Failed to delete item')
          }
        },
      })
    }
  }

  const openNewForm = () => {
    setEditingItem(null)
    setFormName('')
    setFormDescription('')
    setFormRate(0)
    setFormTaxes([{ name: 'GST', rate: 5, enabled: true }])
    setFormIncomeAccount('Sales')
    setFormStock('')
    setFormCurrency('CAD')
    setShowCreateModal(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) return
    setSaving(true)

    try {
      if (editingItem) {
        // Update
        const res = await fetch(`/api/items/${editingItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName,
            description: formDescription,
            rate: formRate,
            taxes: serializeItemTaxes(formTaxes),
            category: editingItem.category,
          }),
        })
        if (!res.ok) {
          toast.error('Failed to update item')
          return
        }
      } else {
        // Create
        const res = await fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: formName,
            description: formDescription,
            rate: formRate,
            taxes: serializeItemTaxes(formTaxes),
            category: activeTab === 'services' ? 'service' : 'item',
          }),
        })
        if (!res.ok) {
          toast.error('Failed to create item')
          return
        }
      }

      setShowCreateModal(false)
      setEditingItem(null)
      fetchItems()
    } catch {
      toast.error('Failed to save item')
    } finally {
      setSaving(false)
    }
  }

  const totalPages = pagination?.totalPages || 1
  const totalItems = pagination?.total || filteredItems.length

  return (
    <div>
      {dialog}
      {/* L1: Header -- Title "Items and Services" */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Items and Services
        </h1>
        {/* L5: Create New... dropdown */}
        <PrimaryButton onClick={openNewForm}>Create New...</PrimaryButton>
      </div>

      {/* L4: Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <button
            onClick={() => {
              setActiveTab('items')
              setSelectedIds(new Set())
              setCurrentPage(1)
            }}
            className={`border-b-2 pb-3 text-sm font-medium ${
              activeTab === 'items'
                ? 'border-[#2FA84F] text-[#2FA84F]'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            Items
          </button>
          <button
            onClick={() => {
              setActiveTab('services')
              setSelectedIds(new Set())
              setCurrentPage(1)
            }}
            className={`border-b-2 pb-3 text-sm font-medium ${
              activeTab === 'services'
                ? 'border-[#2FA84F] text-[#2FA84F]'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            Services
          </button>
        </nav>
      </div>

      {/* L6: Search */}
      <div className="mb-4 max-w-md">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <svg
              className="h-4 w-4 text-gray-400"
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
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setCurrentPage(1)
            }}
            placeholder="Search items and services..."
            className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
          />
        </div>
      </div>

      {/* Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-3">
          <span className="text-sm text-gray-600">
            {selectedIds.size} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleBulkAction('archive')}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Archive
            </button>
            <button
              onClick={() => handleBulkAction('delete')}
              className="rounded border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
            <button
              onClick={() => handleBulkAction('duplicate')}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Duplicate
            </button>
          </div>
        </div>
      )}

      {/* L3: Table -- Title Case headers */}
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E1E6EB]">
              <th className="w-10 px-4 py-1">
                <input
                  type="checkbox"
                  checked={
                    filteredItems.length > 0 &&
                    selectedIds.size === filteredItems.length
                  }
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-gray-300 text-[#2FA84F] focus:ring-[#2FA84F]"
                />
              </th>
              <th className="px-6 py-1 text-left text-xs font-normal text-[#576981]">
                Name
              </th>
              <th className="px-6 py-1 text-left text-xs font-normal text-[#576981]">
                Description
              </th>
              <th className="px-6 py-1 text-left text-xs font-normal text-[#576981]">
                Income Account
              </th>
              <th className="px-6 py-1 text-left text-xs font-normal text-[#576981]">
                Current Stock
              </th>
              <th className="px-6 py-1 text-left text-xs font-normal text-[#576981]">
                Taxes
              </th>
              <th className="px-6 py-1 text-right text-xs font-normal text-[#576981]">
                Rate
              </th>
              <th className="w-10 px-2 py-1" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E1E6EB]">
            {loading ? (
              /* P6: Loading skeleton */
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td className="px-4 py-1"><div className="h-4 w-4 rounded bg-gray-200 animate-pulse" /></td>
                  <td className="px-6 py-1"><div className="h-4 w-24 rounded bg-gray-200 animate-pulse" /></td>
                  <td className="px-6 py-1"><div className="h-4 w-32 rounded bg-gray-200 animate-pulse" /></td>
                  <td className="px-6 py-1"><div className="h-4 w-16 rounded bg-gray-200 animate-pulse" /></td>
                  <td className="px-6 py-1"><div className="h-4 w-12 rounded bg-gray-200 animate-pulse" /></td>
                  <td className="px-6 py-1"><div className="h-4 w-16 rounded bg-gray-200 animate-pulse" /></td>
                  <td className="px-6 py-1"><div className="h-4 w-16 rounded bg-gray-200 animate-pulse ml-auto" /></td>
                  <td className="px-2 py-1" />
                </tr>
              ))
            ) : filteredItems.length === 0 ? (
              /* P7: Empty state with CTA */
              <tr>
                <td
                  colSpan={8}
                  className="px-6 py-16 text-center"
                >
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                  <p className="text-sm text-gray-500 mb-3">
                    No {activeTab} found.
                  </p>
                  <PrimaryButton onClick={openNewForm}>
                    Create Your First {activeTab === 'services' ? 'Service' : 'Item'}
                  </PrimaryButton>
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRowAction('edit', item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleRowAction('edit', item)
                    }
                  }}
                  className="table-row-hover cursor-pointer"
                >
                  <td className="w-10 px-4 py-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      className="h-4 w-4 rounded border-gray-300 text-[#2FA84F] focus:ring-[#2FA84F]"
                    />
                  </td>
                  <td className="px-6 py-1 font-medium text-[#001B40]">
                    {item.name}
                  </td>
                  <td className="px-6 py-1 text-[#576981]">
                    {item.description || '-'}
                  </td>
                  <td className="px-6 py-1 text-[#576981]">Sales</td>
                  <td className="px-6 py-1 text-[#576981]">&mdash;</td>
                  <td className="px-6 py-1 text-[#576981]">
                    {formatTaxList(parseItemTaxes(item.taxes))}
                  </td>
                  <td className="px-6 py-1 text-right text-[#001B40] whitespace-nowrap">
                    ${Number(item.rate).toLocaleString('en-CA', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })} CAD
                  </td>
                  {/* L8: Row actions overflow menu */}
                  <td data-overflow-menu className="w-10 px-2 py-1 relative" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOverflowMenuId(overflowMenuId === item.id ? null : item.id)
                      }}
                      className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <circle cx="12" cy="5" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="12" cy="19" r="2" />
                      </svg>
                    </button>
                    {overflowMenuId === item.id && (
                      <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
                        <button
                          onClick={() => handleRowAction('edit', item)}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRowAction('duplicate', item)}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => handleRowAction('archive', item)}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Archive
                        </button>
                        <button
                          onClick={() => handleRowAction('delete', item)}
                          className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* L6: Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <div className="flex items-center gap-4">
              <div className="text-sm text-gray-500">
                {(currentPage - 1) * perPage + 1}-{Math.min(currentPage * perPage, totalItems)} of {totalItems} {activeTab}
              </div>
              <div className="flex items-center gap-1.5 text-sm text-gray-500">
                <span>Show</span>
                <select
                  value={perPage}
                  onChange={(e) => {
                    setPerPage(Number(e.target.value))
                    setCurrentPage(1)
                  }}
                  className="border border-gray-300 rounded px-1.5 py-0.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
                >
                  {PER_PAGE_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <span>per page</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage <= 1}
                className={`px-3 py-1.5 text-sm font-medium rounded-md border ${
                  currentPage <= 1
                    ? 'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed'
                    : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
                }`}
              >
                Previous
              </button>
              <button
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                disabled={currentPage >= totalPages}
                className={`px-3 py-1.5 text-sm font-medium rounded-md border ${
                  currentPage >= totalPages
                    ? 'text-gray-400 bg-gray-100 border-gray-200 cursor-not-allowed'
                    : 'text-gray-700 bg-white border-gray-300 hover:bg-gray-50'
                }`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* L7: Create/Edit New Modal */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setShowCreateModal(false); setEditingItem(null); setOverflowMenuId(null) }}
        >
          <div
            className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingItem ? 'Edit' : 'Create New'} {activeTab === 'services' ? 'Service' : 'Item'}
              </h2>
              <button
                onClick={() => { setShowCreateModal(false); setEditingItem(null) }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Name
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Item name"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Description (optional)"
                  rows={2}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Income Account
                </label>
                <select
                  value={formIncomeAccount}
                  onChange={(e) => setFormIncomeAccount(e.target.value)}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:outline-none"
                >
                  <option value="Sales">Sales</option>
                </select>
              </div>

              <TaxRowsEditor taxes={formTaxes} onChange={setFormTaxes} />

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Rate
                  </label>
                  <input
                    type="number"
                    value={formRate || ''}
                    onChange={(e) => setFormRate(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Currency
                  </label>
                  <select
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:outline-none"
                  >
                    <option value="CAD">CAD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Current Stock
                </label>
                <input
                  type="text"
                  value={formStock}
                  onChange={(e) => setFormStock(e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => { setShowCreateModal(false); setEditingItem(null) }}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <PrimaryButton onClick={handleSave} disabled={saving || !formName.trim()}>
                {saving ? 'Saving...' : 'Save'}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
