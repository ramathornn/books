'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import NewCategoryDialog from './NewCategoryDialog'
import AttachmentList from '@/components/ui/AttachmentList'

interface Category {
  id: string
  name: string
  groupName: string
}
interface Vendor { id: string; name: string }
interface ClientOpt { id: string; name: string }
interface ProjectOpt { id: string; name: string; clientId: string | null }

const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annually', label: 'Annually' },
]

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP']

interface Props {
  mode: 'new' | 'edit'
  expense?: {
    id: string
    categoryId: string
    vendorId: string | null
    clientId: string | null
    projectId: string | null
    date: string
    amount: number
    taxAmount: number
    currency: string
    description: string
    notes: string
    receiptUrl: string
    isBillable: boolean
    isRecurring: boolean
    recurringFrequency: string | null
  }
  filedReceipt?: { fileId: string; folderId: string | null; folderName: string } | null
}

export default function ExpenseForm({ mode, expense, filedReceipt }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [categories, setCategories] = useState<Category[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [projects, setProjects] = useState<ProjectOpt[]>([])

  const [categoryId, setCategoryId] = useState(expense?.categoryId || '')
  const [vendorName, setVendorName] = useState('')
  const [vendorId, setVendorId] = useState(expense?.vendorId || '')
  const [date, setDate] = useState(
    expense?.date ? expense.date.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const [amount, setAmount] = useState(expense?.amount ?? 0)
  const [taxAmount, setTaxAmount] = useState(expense?.taxAmount ?? 0)
  const [showTaxes, setShowTaxes] = useState(Number(expense?.taxAmount ?? 0) > 0)
  const [currency, setCurrency] = useState(expense?.currency || 'CAD')
  const [description, setDescription] = useState(expense?.description || '')
  const [notes, setNotes] = useState(expense?.notes || '')
  const [receiptUrl, setReceiptUrl] = useState(expense?.receiptUrl || '')

  const [showClientPanel, setShowClientPanel] = useState(
    Boolean(expense?.clientId || expense?.projectId)
  )
  const [clientId, setClientId] = useState(expense?.clientId || '')
  const [projectId, setProjectId] = useState(expense?.projectId || '')
  const [isBillable, setIsBillable] = useState(expense?.isBillable ?? false)

  const [showRecurringPanel, setShowRecurringPanel] = useState(
    Boolean(expense?.isRecurring)
  )
  const [isRecurring, setIsRecurring] = useState(expense?.isRecurring ?? false)
  const [recurringFrequency, setRecurringFrequency] = useState(
    expense?.recurringFrequency || 'monthly'
  )

  const [newCategoryOpen, setNewCategoryOpen] = useState(false)

  useEffect(() => {
    fetch('/api/expense-categories').then((r) => r.json()).then((d) => setCategories(d.data || []))
    fetch('/api/vendors').then((r) => r.json()).then((d) => setVendors(d.data || []))
    fetch('/api/clients?limit=500').then((r) => r.json()).then((d) => setClients(
      (d.data || []).map((c: { id: string; organization: string; firstName: string; lastName: string }) => ({
        id: c.id,
        name: c.organization || `${c.firstName} ${c.lastName}`.trim(),
      }))
    ))
    fetch('/api/projects').then((r) => r.json()).then((d) => setProjects(d.data || []))
  }, [])

  // If initial edit state has a vendor, prefill text
  useEffect(() => {
    if (expense?.vendorId && vendors.length) {
      const m = vendors.find((mm) => mm.id === expense.vendorId)
      if (m) setVendorName(m.name)
    }
  }, [vendors, expense?.vendorId])

  const grandTotal = Number(amount) + Number(taxAmount || 0)

  async function handleSave() {
    setError('')
    if (!categoryId) {
      setError('Please select a category.')
      return
    }
    if (!amount || amount <= 0) {
      setError('Please enter an amount.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        categoryId,
        vendorId: vendorId || null,
        vendorName: vendorId ? undefined : vendorName,
        clientId: showClientPanel ? clientId || null : null,
        projectId: showClientPanel ? projectId || null : null,
        date,
        amount,
        taxAmount,
        currency,
        description,
        notes,
        receiptUrl,
        isBillable: showClientPanel ? isBillable : false,
        isRecurring: showRecurringPanel ? isRecurring : false,
        recurringFrequency: showRecurringPanel && isRecurring ? recurringFrequency : null,
      }
      const url = mode === 'edit' ? `/api/expenses/${expense!.id}` : '/api/expenses'
      const method = mode === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Save failed')
      }
      router.push('/expenses')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  // Group categories for select
  const groupedCats = categories.reduce((acc, c) => {
    if (!acc[c.groupName]) acc[c.groupName] = []
    acc[c.groupName].push(c)
    return acc
  }, {} as Record<string, Category[]>)

  const filteredProjects = clientId
    ? projects.filter((p) => p.clientId === clientId)
    : projects

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          {mode === 'edit' ? 'Edit Expense' : 'New Expense'}
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/expenses')}
            className="px-4 py-2 text-sm font-medium text-[#576981] hover:text-[#001B40]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-white rounded-lg border border-[#E1E6EB] p-6">
          {/* Category */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-[#001B40]">
                Category <span className="text-[#BF2600]">*</span>
              </label>
              <button
                type="button"
                onClick={() => setNewCategoryOpen(true)}
                className="text-xs text-[#0075DD] hover:underline"
              >
                + New Category
              </button>
            </div>
            <select
              value={categoryId}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  setNewCategoryOpen(true)
                  return
                }
                setCategoryId(e.target.value)
              }}
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            >
              <option value="">
                {categories.length === 0
                  ? 'No categories yet — create one'
                  : 'Add category (required)'}
              </option>
              {Object.entries(groupedCats).map(([group, cats]) => (
                <optgroup key={group} label={group}>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
              <option value="__new__">+ Create new category…</option>
            </select>
          </div>

          <NewCategoryDialog
            isOpen={newCategoryOpen}
            onClose={() => setNewCategoryOpen(false)}
            onCreated={(cat) => {
              setCategories((prev) => {
                const next = [...prev, cat]
                next.sort((a, b) => {
                  if (a.groupName !== b.groupName)
                    return a.groupName.localeCompare(b.groupName)
                  return a.name.localeCompare(b.name)
                })
                return next
              })
              setCategoryId(cat.id)
            }}
          />

          {/* Date */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[#001B40] mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
          </div>

          {/* Vendor */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[#001B40] mb-1">Vendor</label>
            <input
              type="text"
              list="vendors-list"
              value={vendorName}
              onChange={(e) => {
                setVendorName(e.target.value)
                const match = vendors.find((m) => m.name === e.target.value)
                setVendorId(match?.id || '')
              }}
              placeholder="Add vendor"
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
            <datalist id="vendors-list">
              {vendors.map((m) => <option key={m.id} value={m.name} />)}
            </datalist>
          </div>

          {/* Receipt URL (optional) */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[#001B40] mb-1">Receipt URL (optional)</label>
            <input
              type="url"
              value={receiptUrl}
              onChange={(e) => setReceiptUrl(e.target.value)}
              placeholder="https://... (link to a hosted receipt)"
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
          </div>

          {/* Attachments — shown only after first save */}
          {mode === 'edit' && expense && (
            <div className="mb-4">
              <label className="block text-sm font-medium text-[#001B40] mb-1">Attachments</label>
              <AttachmentList entityType="expense" entityId={expense.id} />
              {filedReceipt && (
                <a
                  href={filedReceipt.folderId ? `/files?folder=${filedReceipt.folderId}` : '/files'}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm text-[#0075DD] hover:underline"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
                  </svg>
                  Filed in Files → {filedReceipt.folderName}
                </a>
              )}
            </div>
          )}

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[#001B40] mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add description (optional)"
              rows={3}
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
          </div>

          {/* Taxes */}
          {!showTaxes ? (
            <button
              type="button"
              onClick={() => setShowTaxes(true)}
              className="text-sm text-[#0075DD] hover:underline mb-4"
            >
              + Add Taxes
            </button>
          ) : (
            <div className="mb-4">
              <label className="block text-sm font-medium text-[#001B40] mb-1">
                Tax Amount ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                value={taxAmount || ''}
                onChange={(e) => setTaxAmount(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
              />
            </div>
          )}

          {/* Amount */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-[#001B40] mb-1">
              Amount ({currency}) <span className="text-[#BF2600]">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              value={amount || ''}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              placeholder="0.00"
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-lg font-semibold text-right focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
          </div>

          {/* Grand Total */}
          <div className="pt-4 border-t border-[#E1E6EB] flex items-center justify-between">
            <span className="text-sm font-semibold text-[#001B40]">Grand Total ({currency}):</span>
            <span className="text-xl font-bold text-[#001B40]">
              ${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Settings Panel */}
        <aside className="bg-white rounded-lg border border-[#E1E6EB] p-4 h-fit">
          <h3 className="text-sm font-semibold text-[#001B40] mb-4">Expense Settings</h3>

          {/* Assign to Client/Project */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowClientPanel(!showClientPanel)}
              className="w-full flex items-center justify-between text-left p-2 hover:bg-[#F5F7FA] rounded"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#001B40]">Assign to Client/Project</div>
                  <div className="text-xs text-[#576981]">Mark as Billable or Non-Billable</div>
                </div>
              </div>
              <svg className={`w-4 h-4 text-[#576981] transition-transform ${showClientPanel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showClientPanel && (
              <div className="mt-2 pl-2 space-y-2">
                <select
                  value={clientId}
                  onChange={(e) => {
                    setClientId(e.target.value)
                    setProjectId('')
                  }}
                  className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
                >
                  <option value="">Select client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded"
                >
                  <option value="">Select project (optional)</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={isBillable}
                      onChange={() => setIsBillable(true)}
                    />
                    Billable
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      checked={!isBillable}
                      onChange={() => setIsBillable(false)}
                    />
                    Non-Billable
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Recurring */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowRecurringPanel(!showRecurringPanel)}
              className="w-full flex items-center justify-between text-left p-2 hover:bg-[#F5F7FA] rounded"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h5M20 20v-5h-5M4 9a9 9 0 0114-6.7L20 4M20 15a9 9 0 01-14 6.7L4 20" />
                </svg>
                <div>
                  <div className="text-sm font-medium text-[#001B40]">Make Recurring</div>
                  <div className="text-xs text-[#576981]">Repeat this expense automatically</div>
                </div>
              </div>
              <svg className={`w-4 h-4 text-[#576981] transition-transform ${showRecurringPanel ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showRecurringPanel && (
              <div className="mt-2 pl-2 space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                  />
                  Recurring
                </label>
                <select
                  value={recurringFrequency}
                  onChange={(e) => setRecurringFrequency(e.target.value)}
                  disabled={!isRecurring}
                  className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded disabled:opacity-50"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Currency */}
          <div className="mb-4">
            <div className="flex items-center justify-between p-2">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 10v2m0 0a9 9 0 110-18 9 9 0 010 18z" />
                </svg>
                <span className="text-sm font-medium text-[#001B40]">Currency</span>
              </div>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="px-2 py-1 text-sm border border-[#E1E6EB] rounded"
              >
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-[#576981] mb-1">Internal Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded resize-none"
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
