'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface CategoryOption {
  id: string
  name: string
  groupName: string
}

interface TaxCodeOption {
  id: string
  code: string
  name: string
}

interface Props {
  mode: 'new' | 'edit'
  vendor?: {
    id: string
    name: string
    displayName: string
    contactName: string
    email: string
    phone: string
    website: string
    address: string
    gstNumber: string
    defaultCategoryId: string | null
    defaultTaxCodeId: string | null
    defaultPayee: string
    isContractor: boolean
    isArchived: boolean
  }
}

export default function VendorForm({ mode, vendor }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [name, setName] = useState(vendor?.name || '')
  const [displayName, setDisplayName] = useState(vendor?.displayName || '')
  const [contactName, setContactName] = useState(vendor?.contactName || '')
  const [email, setEmail] = useState(vendor?.email || '')
  const [phone, setPhone] = useState(vendor?.phone || '')
  const [website, setWebsite] = useState(vendor?.website || '')
  const [address, setAddress] = useState(vendor?.address || '')
  const [gstNumber, setGstNumber] = useState(vendor?.gstNumber || '')
  const [defaultCategoryId, setDefaultCategoryId] = useState(vendor?.defaultCategoryId || '')
  const [defaultTaxCodeId, setDefaultTaxCodeId] = useState(vendor?.defaultTaxCodeId || '')
  const [defaultPayee, setDefaultPayee] = useState(vendor?.defaultPayee || '')
  const [isContractor, setIsContractor] = useState(vendor?.isContractor || false)
  const [isArchived, setIsArchived] = useState(vendor?.isArchived || false)

  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [taxCodes, setTaxCodes] = useState<TaxCodeOption[]>([])

  useEffect(() => {
    fetch('/api/expense-categories')
      .then((r) => r.json())
      .then((d) => setCategories(d.data || []))
      .catch(() => {})
    fetch('/api/tax-codes')
      .then((r) => r.json())
      .then((d) => setTaxCodes(d.data || []))
      .catch(() => {})
  }, [])

  async function handleSave() {
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        displayName,
        contactName,
        email,
        phone,
        website,
        address,
        gstNumber,
        defaultCategoryId: defaultCategoryId || null,
        defaultTaxCodeId: defaultTaxCodeId || null,
        defaultPayee,
        isContractor,
        isArchived,
      }
      const url = mode === 'edit' ? `/api/vendors/${vendor!.id}` : '/api/vendors'
      const method = mode === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      router.push('/vendors')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!vendor) return
    if (!confirm('Archive this vendor?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      router.push('/vendors')
      router.refresh()
    } catch {
      setError('Delete failed')
    } finally {
      setSaving(false)
    }
  }

  // Group categories
  const grouped = categories.reduce((acc, c) => {
    if (!acc[c.groupName]) acc[c.groupName] = []
    acc[c.groupName].push(c)
    return acc
  }, {} as Record<string, CategoryOption[]>)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {mode === 'edit' ? 'Edit Vendor' : 'New Vendor'}
        </h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/vendors')}
            className="px-4 py-2 text-sm font-medium text-[#576981] hover:text-[#001B40]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Vendor'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="bg-white rounded-lg border border-[#E1E6EB] p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Name" required>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Telus Communications"
                className={inputCls}
                autoFocus
              />
            </Field>

            <Field label="Display Name">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Optional friendly name"
                className={inputCls}
              />
            </Field>

            <Field label="Contact Name">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Email">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputCls}
              />
            </Field>

            <Field label="Website">
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://"
                className={inputCls}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Address">
                <textarea
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  rows={2}
                  className={`${inputCls} h-auto py-2`}
                />
              </Field>
            </div>

            <Field label="GST/HST #">
              <input
                value={gstNumber}
                onChange={(e) => setGstNumber(e.target.value)}
                placeholder="123456789RT0001"
                className={`${inputCls} font-mono`}
              />
            </Field>

            <Field label="Default Payee Text">
              <input
                value={defaultPayee}
                onChange={(e) => setDefaultPayee(e.target.value)}
                placeholder="Used as bank-tx payee label"
                className={inputCls}
              />
            </Field>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-[#E1E6EB] p-4">
            <h3 className="text-sm font-semibold text-[#001B40] mb-3">Bookkeeping defaults</h3>
            <div className="space-y-3">
              <Field label="Default Category">
                <select
                  value={defaultCategoryId}
                  onChange={(e) => setDefaultCategoryId(e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">— None —</option>
                  {Object.entries(grouped).map(([group, cats]) => (
                    <optgroup key={group} label={group}>
                      {cats.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>

              <Field label="Default Tax Code">
                <select
                  value={defaultTaxCodeId}
                  onChange={(e) => setDefaultTaxCodeId(e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">— None —</option>
                  {taxCodes.map((tc) => (
                    <option key={tc.id} value={tc.id}>
                      {tc.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-[#E1E6EB] p-4">
            <h3 className="text-sm font-semibold text-[#001B40] mb-3">Tags</h3>
            <label className="flex items-center gap-2 text-sm text-[#001B40]">
              <input
                type="checkbox"
                checked={isContractor}
                onChange={(e) => setIsContractor(e.target.checked)}
                className="rounded border-[#E1E6EB]"
              />
              Track as Contractor (T4A-eligible)
            </label>
            {mode === 'edit' && (
              <label className="mt-2 flex items-center gap-2 text-sm text-[#001B40]">
                <input
                  type="checkbox"
                  checked={isArchived}
                  onChange={(e) => setIsArchived(e.target.checked)}
                  className="rounded border-[#E1E6EB]"
                />
                Archived
              </label>
            )}
          </div>

          {mode === 'edit' && (
            <button
              onClick={handleDelete}
              disabled={saving}
              className="w-full px-3 py-2 text-sm text-[#BF2600] hover:bg-[#FDECEA] rounded border border-transparent hover:border-[#FBC8C0]"
            >
              Archive vendor
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#576981] mb-1">
        {label}
        {required && <span className="text-[#BF2600] ml-1">*</span>}
      </span>
      {children}
    </label>
  )
}
