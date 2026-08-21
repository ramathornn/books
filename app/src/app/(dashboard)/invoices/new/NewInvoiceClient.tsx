'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { stripCountryFromAddress as stripCountryFromAddressClient } from '@/lib/utils'
import type { CompanyInfo } from '@/lib/company'
import ClientPickerDropdown from '@/components/client/ClientPickerDropdown'
import QuickClientModal from '@/components/client/QuickClientModal'
import AutoTextarea from '@/components/ui/AutoTextarea'
import DateInput from '@/components/ui/DateInput'
import DueDatePicker from '@/components/ui/DueDatePicker'

interface LineItem {
  id: string
  title: string
  description: string
  rate: number
  quantity: number
  taxCodes: string[]
}

interface ClientData {
  id: string
  firstName: string
  lastName: string
  organization: string
  email: string
  phone?: string
  address?: string
  country?: string
  vatId?: string
  currency?: string
}

interface CatalogItem {
  id: string
  name: string
  description: string
  rate: number | string
  taxes: string
}

function generateId() {
  return Math.random().toString(36).substring(2, 15)
}

function clientDisplayName(c: ClientData) {
  return c.organization || `${c.firstName} ${c.lastName}`.trim()
}

function getCurrencySymbol(currency: string) {
  const map: Record<string, string> = { CAD: '$', USD: '$', EUR: '\u20ac', GBP: '\u00a3' }
  return map[currency.toUpperCase()] || '$'
}

function fmtMoney(amount: number, currency: string) {
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const prefix = amount < 0 ? '-' : ''
  return `${prefix}${symbol}${formatted}`
}

const ghostInput = 'w-full bg-transparent border border-transparent rounded px-2 py-1 text-sm hover:border-[#E1E6EB] focus:outline-none focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F] focus:bg-white'

function fmtPlain(amount: number) {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const prefix = amount < 0 ? '-' : ''
  return `${prefix}${formatted}`
}

function TaxPopover({
  initial,
  onApply,
  onCancel,
}: {
  initial: { name: string; rate: number }[]
  onApply: (taxes: { name: string; rate: number }[]) => void
  onCancel: () => void
}) {
  const seeded = initial.length > 0 ? initial : [{ name: 'GST', rate: 5 }]
  const [taxes, setTaxes] = useState(seeded)
  const [enabled, setEnabled] = useState(initial.map(() => true).concat(initial.length === 0 ? [true] : []))

  function updateName(i: number, name: string) {
    setTaxes(taxes.map((t, idx) => (idx === i ? { ...t, name } : t)))
  }
  function updateRate(i: number, rate: number) {
    setTaxes(taxes.map((t, idx) => (idx === i ? { ...t, rate } : t)))
  }
  function toggle(i: number) {
    setEnabled(enabled.map((e, idx) => (idx === i ? !e : e)))
  }
  function addAnother() {
    setTaxes([...taxes, { name: '', rate: 0 }])
    setEnabled([...enabled, true])
  }
  function apply() {
    onApply(taxes.filter((_, i) => enabled[i] && taxes[i].name.trim()))
  }

  return (
    <div className="absolute z-30 right-0 top-full mt-1 bg-white border border-[#E1E6EB] rounded-md shadow-lg p-4 w-[360px] text-left">
      <div className="text-sm font-semibold text-[#001B40] mb-3">Add Taxes</div>
      <div className="grid grid-cols-[auto_80px_1fr_1fr] gap-2 items-center mb-2 text-xs text-[#576981]">
        <span></span>
        <span>Rate</span>
        <span>Tax Name</span>
        <span>Tax Number (Optional)</span>
      </div>
      {taxes.map((t, i) => (
        <div key={i} className="grid grid-cols-[auto_80px_1fr_1fr] gap-2 items-center mb-2">
          <input
            type="checkbox"
            checked={enabled[i] ?? false}
            onChange={() => toggle(i)}
            className="h-4 w-4 rounded border-gray-300 text-[#2FA84F] focus:ring-[#2FA84F]"
          />
          <div className="relative">
            <input
              type="number"
              value={t.rate || ''}
              onChange={(e) => updateRate(i, parseFloat(e.target.value) || 0)}
              className="w-full px-2 py-1 pr-5 border border-[#E1E6EB] rounded text-sm text-right focus:outline-none focus:border-[#0075DD]"
              step="0.01"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#576981]">%</span>
          </div>
          <input
            type="text"
            value={t.name}
            onChange={(e) => updateName(i, e.target.value)}
            placeholder="GST"
            className="w-full px-2 py-1 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:border-[#0075DD]"
          />
          <input
            type="text"
            placeholder="Tax number"
            className="w-full px-2 py-1 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:border-[#0075DD]"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={addAnother}
        className="w-full border border-dashed border-[#E1E6EB] rounded py-2 text-sm text-[#0075DD] hover:bg-gray-50 mb-3"
      >
        + Add another Tax
      </button>
      <div className="flex justify-end gap-2 pt-2 border-t border-[#E1E6EB]">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-[#576981] hover:bg-gray-50 rounded">Cancel</button>
        <button type="button" onClick={apply} className="px-3 py-1.5 text-sm bg-[#2FA84F] text-white rounded hover:bg-[#268f3e]">Apply Taxes</button>
      </div>
    </div>
  )
}

function SettingsTile({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  trailing?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-4 py-3 bg-white border-b border-[#E1E6EB] hover:bg-[#F5F7FA] transition-colors"
    >
      <span className="text-[#576981] mt-0.5">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[#001B40]">{title}</span>
        {subtitle && <span className="block text-xs text-[#576981] mt-0.5">{subtitle}</span>}
      </span>
      <span className="flex items-center gap-2 text-[#576981]">
        {trailing}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
      </span>
    </button>
  )
}

export default function NewInvoicePage({ company }: { company: CompanyInfo }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const duplicateId = searchParams.get('duplicate')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const pendingNavRef = useRef<string | null>(null)
  const [showDiscount, setShowDiscount] = useState(false)
  const [discount, setDiscount] = useState(0)

  const [clientId, setClientId] = useState('')
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null)
  const [clientModal, setClientModal] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    initial?: ClientData
  }>({ open: false, mode: 'create' })

  const [dateIssued, setDateIssued] = useState(new Date().toISOString().split('T')[0])
  const [dateDue, setDateDue] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [reference, setReference] = useState('')
  const [currency, setCurrency] = useState('CAD')
  // Tracks whether the user has explicitly chosen a currency, so selecting a
  // client only pre-fills the default without clobbering a manual choice.
  const currencyTouchedRef = useRef(false)
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: generateId(), title: '', description: '', rate: 0, quantity: 1, taxCodes: [] },
  ])

  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [activeItemDropdown, setActiveItemDropdown] = useState<string | null>(null)
  const [activeTaxPopover, setActiveTaxPopover] = useState<string | null>(null)
  const [settingsView, setSettingsView] = useState<'main' | 'currency' | 'payments'>('main')
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState(false)

  // Load clients
  useEffect(() => {
    fetch('/api/clients?limit=100')
      .then((res) => res.json())
      .then((data) => {
        setClients(data.data || data || [])
      })
      .catch(() => {})
  }, [])

  // Load next invoice number (auto-increment, 7-digit zero-padded)
  useEffect(() => {
    fetch('/api/invoices/next-number')
      .then((res) => res.json())
      .then((data) => setInvoiceNumber(data.nextNumber || ''))
      .catch(() => {})
  }, [])

  // Load catalog items
  useEffect(() => {
    fetch('/api/items?limit=100')
      .then((res) => res.json())
      .then((data) => {
        setCatalogItems(data.data || data || [])
      })
      .catch(() => {})
  }, [])

  // Prefill from an existing invoice when ?duplicate=<id> is set
  useEffect(() => {
    if (!duplicateId) return
    fetch(`/api/invoices/${duplicateId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((source) => {
        if (!source) return
        if (source.client) {
          setSelectedClient(source.client)
          setClientId(source.client.id || source.clientId || '')
        } else if (source.clientId) {
          setClientId(source.clientId)
        }
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const srcIssued = source.dateIssued ? new Date(source.dateIssued) : today
        const srcDue = source.dateDue ? new Date(source.dateDue) : today
        const offsetDays = Math.max(
          0,
          Math.round((srcDue.getTime() - srcIssued.getTime()) / (1000 * 60 * 60 * 24))
        )
        const newDue = new Date(today)
        newDue.setDate(newDue.getDate() + (offsetDays || 30))
        setDateIssued(today.toISOString().split('T')[0])
        setDateDue(newDue.toISOString().split('T')[0])
        // The duplicated invoice's currency is an explicit choice — keep it
        // rather than letting the prefilled client's default override it.
        currencyTouchedRef.current = true
        setCurrency(source.currency || 'CAD')
        setReference(source.reference || '')
        setNotes(source.notes || '')
        setTerms(source.terms || '')
        setOnlinePaymentsEnabled(Boolean(source.onlinePaymentsEnabled))
        const discountVal =
          typeof source.discount === 'string' ? parseFloat(source.discount) : source.discount
        if (discountVal && discountVal > 0) {
          setDiscount(discountVal)
          setShowDiscount(true)
        }
        if (Array.isArray(source.lineItems) && source.lineItems.length > 0) {
          setLineItems(
            source.lineItems.map((item: {
              title?: string
              description?: string
              rate: number | string
              quantity: number | string
              taxCodes?: string[]
            }) => ({
              id: generateId(),
              title: item.title || '',
              description: item.description || '',
              rate: Number(item.rate),
              quantity: Number(item.quantity),
              taxCodes: item.taxCodes || [],
            }))
          )
        }
      })
      .catch(() => {})
  }, [duplicateId])

  // Track dirty state
  useEffect(() => {
    const hasContent =
      clientId !== '' ||
      notes !== '' ||
      terms !== '' ||
      reference !== '' ||
      discount !== 0 ||
      onlinePaymentsEnabled ||
      lineItems.some((li) => li.title.trim() !== '' || li.description.trim() !== '' || li.rate !== 0)
    setIsDirty(hasContent)
  }, [clientId, notes, terms, reference, discount, onlinePaymentsEnabled, lineItems])

  // Warn before unload
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  function parseTax(code: string): { name: string; rate: number } {
    const [name, rateStr] = code.split(':')
    return { name: name || '', rate: parseFloat(rateStr || '0') || 0 }
  }

  const subtotal = lineItems.reduce((sum, item) => sum + item.rate * item.quantity, 0)
  const taxAmount = lineItems.reduce((sum, item) => {
    const lineTotal = item.rate * item.quantity
    const lineTaxes = item.taxCodes.reduce((acc, tc) => {
      const { rate } = parseTax(tc)
      return acc + lineTotal * (rate / 100)
    }, 0)
    return sum + lineTaxes
  }, 0)
  const total = subtotal - discount + taxAmount
  const amountDue = total

  function addLine() {
    setLineItems([
      ...lineItems,
      { id: generateId(), title: '', description: '', rate: 0, quantity: 1, taxCodes: [] },
    ])
  }

  function removeLine(lineId: string) {
    if (lineItems.length <= 1) return
    setLineItems(lineItems.filter((item) => item.id !== lineId))
  }

  function duplicateLine(lineId: string) {
    const idx = lineItems.findIndex((item) => item.id === lineId)
    if (idx === -1) return
    const copy = { ...lineItems[idx], id: generateId(), taxCodes: [...lineItems[idx].taxCodes] }
    const next = [...lineItems]
    next.splice(idx + 1, 0, copy)
    setLineItems(next)
  }

  function updateLine(lineId: string, field: keyof LineItem, value: string | number | string[]) {
    setLineItems(
      lineItems.map((item) => (item.id === lineId ? { ...item, [field]: value } : item))
    )
  }

  function setLineTaxes(lineId: string, taxes: { name: string; rate: number }[]) {
    setLineItems(
      lineItems.map((item) =>
        item.id === lineId
          ? { ...item, taxCodes: taxes.filter((t) => t.name.trim()).map((t) => `${t.name.trim()}:${t.rate}`) }
          : item
      )
    )
  }

  function getFilteredCatalogItems(query: string) {
    if (!query.trim()) return catalogItems.slice(0, 8)
    return catalogItems.filter(
      (ci) =>
        ci.name.toLowerCase().includes(query.toLowerCase()) ||
        ci.description.toLowerCase().includes(query.toLowerCase())
    )
  }

  function selectCatalogItem(lineId: string, item: CatalogItem) {
    const rate = typeof item.rate === 'string' ? parseFloat(item.rate) : item.rate
    const hasTax = item.taxes && item.taxes.toUpperCase().includes('GST')
    setLineItems(
      lineItems.map((li) =>
        li.id === lineId
          ? {
              ...li,
              title: item.name,
              description: item.description || '',
              rate: rate || 0,
              taxCodes: hasTax ? ['GST'] : li.taxCodes,
            }
          : li
      )
    )
    setActiveItemDropdown(null)
  }

  const handleCancel = useCallback(() => {
    if (isDirty) {
      pendingNavRef.current = '/invoices'
      setShowDiscardModal(true)
    } else {
      router.push('/invoices')
    }
  }, [isDirty, router])

  const handleSave = useCallback(async () => {
    setError('')
    if (!clientId) {
      setError('Please select a client.')
      return
    }
    const validLines = lineItems.filter((li) => li.title.trim())
    if (validLines.length === 0) {
      setError('At least one line item with a description is required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          dateIssued,
          dateDue,
          currency,
          reference,
          notes,
          terms,
          discount,
          lineItems: validLines.map((item) => ({
            title: item.title,
            description: item.description,
            rate: item.rate,
            quantity: item.quantity,
            taxCodes: item.taxCodes,
          })),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        const details = data.details
          ? Object.entries(data.details as Record<string, string[]>)
              .map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`)
              .join(' \u00b7 ')
          : ''
        throw new Error(details ? `${data.error || 'Validation failed'} \u2014 ${details}` : data.error || 'Failed to create invoice')
      }

      const data = await res.json()
      setIsDirty(false)
      router.push(`/invoices/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }, [clientId, dateIssued, dateDue, currency, notes, terms, reference, lineItems, discount, router])

  return (
    <div>
      {/* Top bar: Cancel | Save */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[40px] leading-[48px] font-medium text-[#001B40]">New Invoice</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-[#576981] bg-white hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 text-red-800 text-sm rounded-md">{error}</div>
      )}

      {/* Two-column: invoice card (left) + Settings panel (right) */}
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-[820px]">
          <div className="bg-white rounded-sm shadow-md px-12 py-12 lg:px-16 lg:py-16">
            {/* Company header */}
            <div className="flex justify-between mb-10 gap-6">
              <div className="relative group">
                <div className="w-[200px] h-[110px] bg-[#F5F7FA] border border-dashed border-[#E1E6EB] rounded flex flex-col items-center justify-center">
                  <div className="text-3xl font-black text-[#1A3353]/30 tracking-tight leading-none">{company.logoInitials}</div>
                </div>
                <button
                  type="button"
                  className="absolute inset-0 flex items-center justify-center text-[13px] text-[#0075DD] bg-white/70 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  Delete image
                </button>
              </div>
              <div className="text-right text-sm text-[#001B40]">
                <div className="font-semibold">{company.legalName}</div>
                <div>+1-555-000-0000</div>
                <div>123 Main Street</div>
                <div>Calgary AB T0A0A0</div>
                <Link href="/settings" className="text-[13px] text-[#0075DD] hover:underline mt-1 inline-block">
                  Edit Business Information
                </Link>
              </div>
            </div>

            {/* FB 4-column meta header */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-6 mb-8">
              {/* Col 1: Billed To */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#0075DD] mb-1">Billed To</div>
                <ClientPickerDropdown
                  clients={clients}
                  selectedClient={selectedClient}
                  onSelect={(client) => {
                    setSelectedClient(client)
                    setClientId(client.id)
                    // Pre-fill the invoice currency from the client's default,
                    // unless the user has already picked one manually.
                    if (!currencyTouchedRef.current && client.currency) {
                      setCurrency(client.currency)
                    }
                  }}
                  onClear={() => {
                    setSelectedClient(null)
                    setClientId('')
                  }}
                  onCreate={() =>
                    setClientModal({ open: true, mode: 'create' })
                  }
                  onEdit={(client) =>
                    setClientModal({ open: true, mode: 'edit', initial: client })
                  }
                />
                {selectedClient && selectedClient.address && (
                  <div className="mt-2 text-sm text-[#576981] whitespace-pre-line">
                    {stripCountryFromAddressClient(selectedClient.address)}
                  </div>
                )}
              </div>

              {/* Col 2: Date of Issue / Due Date */}
              <div>
                <div className="text-sm font-medium text-[#0075DD] mb-1">Date of Issue</div>
                <DateInput value={dateIssued} onChange={setDateIssued} ariaLabel="Date of issue" />
                <div className="text-sm font-medium text-[#0075DD] mt-4 mb-1">Due Date</div>
                <DueDatePicker dateIssued={dateIssued} value={dateDue} onChange={setDateDue} />
                {selectedClient?.vatId && (
                  <>
                    <div className="text-sm font-medium text-[#0075DD] mt-4 mb-1">VAT ID</div>
                    <div className="text-sm text-[#001B40] px-2 py-1">{selectedClient.vatId}</div>
                  </>
                )}
              </div>

              {/* Col 3: Invoice Number / Reference */}
              <div>
                <div className="text-sm font-medium text-[#0075DD] mb-1">Invoice Number</div>
                <div className="text-sm text-[#001B40] px-2 py-1">{invoiceNumber}</div>
                <div className="text-sm font-medium text-[#0075DD] mt-4 mb-1">Reference</div>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Enter value (e.g. PO #)"
                  className={ghostInput}
                />
              </div>

              {/* Col 4: Amount Due */}
              <div className="text-right">
                <div className="text-sm font-medium text-[#0075DD] mb-1">Amount Due ({currency})</div>
                <div className="text-[32px] font-medium text-[#001B40] leading-tight">{fmtMoney(amountDue, currency)}</div>
              </div>
            </div>

            <div className="h-[2px] bg-[#0075DD] mb-6" />

            {/* Line items */}
            <table className="w-full mb-4">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-1 text-xs font-medium text-gray-500 tracking-wider">Description</th>
                  <th className="text-right py-1 text-xs font-medium text-gray-500 tracking-wider w-28">Rate</th>
                  <th className="text-right py-1 text-xs font-medium text-gray-500 tracking-wider w-16">Qty</th>
                  <th className="text-right py-1 text-xs font-medium text-gray-500 tracking-wider w-28">Line Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => {
                  const lineTotal = item.rate * item.quantity
                  const matchedItems = getFilteredCatalogItems(item.title)
                  return (
                    <tr key={item.id} className="border-b border-gray-100">
                      <td className="py-1 relative">
                        <div className="space-y-0.5">
                          <AutoTextarea
                            minRows={1}
                            value={item.title}
                            onChange={(e) => {
                              updateLine(item.id, 'title', e.target.value)
                              setActiveItemDropdown(item.id)
                            }}
                            onFocus={() => setActiveItemDropdown(item.id)}
                            onBlur={() => setTimeout(() => setActiveItemDropdown(null), 200)}
                            placeholder="Item name"
                            className={`${ghostInput} font-medium text-[#001B40] resize-none`}
                          />
                          <AutoTextarea
                            minRows={1}
                            value={item.description}
                            onChange={(e) => updateLine(item.id, 'description', e.target.value)}
                            placeholder="Description (optional)"
                            className={`${ghostInput} text-xs text-[#576981] resize-none`}
                          />
                        </div>
                        {activeItemDropdown === item.id && matchedItems.length > 0 && (
                          <div className="absolute z-30 left-0 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                            {matchedItems.map((ci) => (
                              <button
                                key={ci.id}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => selectCatalogItem(item.id, ci)}
                              >
                                <div className="font-medium text-gray-900">{ci.name}</div>
                                {ci.description && (
                                  <div className="text-xs text-gray-500 truncate">{ci.description}</div>
                                )}
                                <div className="text-xs text-gray-400">
                                  {fmtMoney(typeof ci.rate === 'string' ? parseFloat(ci.rate) : ci.rate, currency)}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-1">
                        <div>
                          <input
                            type="number"
                            value={item.rate || ''}
                            onChange={(e) => updateLine(item.id, 'rate', parseFloat(e.target.value) || 0)}
                            placeholder="0.00"
                            step="0.01"
                            className={`${ghostInput} text-right`}
                          />
                          <div className="text-right mt-0.5 relative">
                            <button
                              type="button"
                              onClick={() => setActiveTaxPopover(activeTaxPopover === item.id ? null : item.id)}
                              className="text-xs font-medium text-[#0075DD] hover:underline"
                            >
                              {item.taxCodes.length > 0
                                ? item.taxCodes.map((tc) => { const t = parseTax(tc); return t.rate ? `${t.name} ${t.rate}%` : t.name }).join(', ')
                                : 'Add Taxes'}
                            </button>
                            {activeTaxPopover === item.id && (
                              <TaxPopover
                                initial={item.taxCodes.map(parseTax)}
                                onApply={(taxes) => {
                                  setLineTaxes(item.id, taxes)
                                  setActiveTaxPopover(null)
                                }}
                                onCancel={() => setActiveTaxPopover(null)}
                              />
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-1">
                        <input
                          type="number"
                          value={item.quantity || ''}
                          onChange={(e) => updateLine(item.id, 'quantity', parseFloat(e.target.value) || 0)}
                          placeholder="1"
                          step="1"
                          min="0"
                          className={`${ghostInput} text-right`}
                        />
                      </td>
                      <td className="py-1 text-right text-sm text-gray-900 pr-2">{fmtMoney(lineTotal, currency)}</td>
                      <td className="py-1 text-center">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            onClick={() => duplicateLine(item.id)}
                            className="text-gray-400 hover:text-[#0075DD] transition-colors ml-1"
                            title="Duplicate line"
                            type="button"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                            </svg>
                          </button>
                          <button
                            onClick={() => removeLine(item.id)}
                            className="text-gray-400 hover:text-red-500 transition-colors ml-1"
                            title="Remove line"
                            type="button"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div className="flex items-center gap-4 mb-6">
              <button onClick={addLine} className="text-sm text-[#2FA84F] hover:text-[#268f3e] font-medium">
                + Add a Line
              </button>
              {!showDiscount && (
                <button onClick={() => setShowDiscount(true)} className="text-sm text-[#2FA84F] hover:text-[#268f3e] font-medium">
                  + Add a Discount
                </button>
              )}
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72">
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-900">{fmtPlain(subtotal)}</span>
                </div>
                {showDiscount && (
                  <div className="flex justify-between py-2 text-sm items-center">
                    <span className="text-gray-500">Discount</span>
                    <input
                      type="number"
                      value={discount || ''}
                      onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                      step="0.01"
                      className={`${ghostInput} max-w-[96px] text-right`}
                    />
                  </div>
                )}
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-gray-500">Tax</span>
                  <span className="text-gray-900">{fmtPlain(taxAmount)}</span>
                </div>
                <div className="flex justify-between py-2 text-sm border-t border-gray-200 font-semibold">
                  <span className="text-gray-900">Total</span>
                  <span className="text-gray-900">{fmtPlain(total)}</span>
                </div>
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-gray-500">Amount Paid</span>
                  <span className="text-gray-900">{fmtPlain(0)}</span>
                </div>
                <div className="flex justify-between py-2 text-sm border-t-2 border-gray-900 font-bold">
                  <span className="text-gray-900">Amount Due ({currency})</span>
                  <span className="text-gray-900">{fmtMoney(amountDue, currency)}</span>
                </div>
              </div>
            </div>

            {/* Notes & Terms */}
            <div className="mt-10 space-y-6">
              <div>
                <div className="text-[15px] font-semibold text-[#0075DD] mb-1">
                  Notes
                </div>
                <AutoTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter notes (optional)"
                  minRows={3}
                  className="w-full bg-transparent border-0 p-0 text-sm text-[#001B40] placeholder-[#8C9BAB] focus:outline-none focus:ring-0 resize-none"
                />
              </div>
              <div>
                <div className="text-[15px] font-semibold text-[#0075DD] mb-1">
                  Terms
                </div>
                <AutoTextarea
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Enter terms (optional)"
                  minRows={3}
                  className="w-full bg-transparent border-0 p-0 text-sm text-[#001B40] placeholder-[#8C9BAB] focus:outline-none focus:ring-0 resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Settings sidebar */}
        <aside className="w-[280px] flex-shrink-0 hidden lg:block relative overflow-hidden">
          <div
            className={`flex w-[840px] transition-transform duration-300 ease-out ${
              settingsView === 'currency'
                ? '-translate-x-[280px]'
                : settingsView === 'payments'
                ? '-translate-x-[560px]'
                : 'translate-x-0'
            }`}
          >
            {/* Main view */}
            <div className="w-[280px] flex-shrink-0 pr-2">
              <div className="text-[15px] font-semibold text-[#001B40] mb-1">Settings</div>
              <div className="text-xs text-[#576981] uppercase tracking-wider mb-3">For This Invoice</div>

              <SettingsTile
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M5 6h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z"/></svg>
                }
                title="Accept Online Payments"
                subtitle="Let clients pay you online"
                trailing={
                  <span className={`text-xs font-semibold ${onlinePaymentsEnabled ? 'text-[#2FA84F]' : 'text-[#576981]'}`}>
                    {onlinePaymentsEnabled ? 'YES' : 'NO'}
                  </span>
                }
                onClick={() => setSettingsView('payments')}
              />
              <SettingsTile
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536M9 11l3.536 3.536L20.5 6.572a2.5 2.5 0 10-3.536-3.536L9 11zm0 0v4h4"/></svg>
                }
                title="Customize Invoice Style"
                subtitle="Change Template, Color, and Font"
              />

              <div className="text-xs text-[#576981] uppercase tracking-wider mt-6 mb-3">
                {selectedClient ? `For ${clientDisplayName(selectedClient)}` : 'For This Client'}
              </div>

              <SettingsTile
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0"/></svg>
                }
                title="Send Reminders"
                subtitle="At Customizable Intervals"
                trailing={<span className="text-xs font-semibold text-[#576981]">NO</span>}
              />
              <SettingsTile
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V6m0 12v-2m9-4a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                }
                title="Charge Late Fees"
                subtitle="Percentage or Flat-Rate Fees"
                trailing={<span className="text-xs font-semibold text-[#576981]">NO</span>}
              />
              <SettingsTile
                icon={
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                }
                title="Currency & Language"
                subtitle={`${currency}, English (United States)`}
                onClick={() => setSettingsView('currency')}
              />
            </div>

            {/* Currency sub-view */}
            <div className="w-[280px] flex-shrink-0 pl-2">
              <button
                type="button"
                onClick={() => setSettingsView('main')}
                className="flex items-center gap-1 text-sm text-[#0075DD] hover:underline mb-3"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back
              </button>
              <h3 className="text-lg font-bold text-[#001B40] mb-4">Currency &amp; Language</h3>
              <label className="block text-sm text-[#576981] mb-1">Choose a Language</label>
              <select
                disabled
                className="w-full px-3 py-2 border-2 border-[#0075DD] rounded-md text-sm text-[#001B40] mb-4"
              >
                <option>English (United States)</option>
              </select>
              <div className="h-px bg-[#E1E6EB] mb-4" />
              <label className="block text-sm text-[#576981] mb-1">Choose a Currency</label>
              <select
                value={currency}
                onChange={(e) => {
                  currencyTouchedRef.current = true
                  setCurrency(e.target.value)
                }}
                className="w-full px-3 py-2 border border-[#E1E6EB] rounded-md text-sm text-[#001B40] focus:outline-none focus:border-[#0075DD] focus:ring-1 focus:ring-[#0075DD] mb-5"
              >
                <option value="CAD">CAD — Canadian dollar</option>
                <option value="USD">USD — US dollar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="GBP">GBP — British pound</option>
                <option value="AUD">AUD — Australian dollar</option>
                <option value="JPY">JPY — Japanese yen</option>
              </select>
              <div className="h-px bg-[#E1E6EB] mb-4" />
              <div className="flex justify-end items-center gap-4">
                <button
                  type="button"
                  onClick={() => setSettingsView('main')}
                  className="text-sm font-semibold text-[#576981] hover:text-[#001B40]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsView('main')}
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md"
                >
                  Done
                </button>
              </div>
            </div>

            {/* Accept Online Payments sub-view */}
            <div className="w-[280px] flex-shrink-0 pl-2">
              <button
                type="button"
                onClick={() => setSettingsView('main')}
                className="flex items-center gap-1 text-sm text-[#0075DD] hover:underline mb-3"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                Back
              </button>
              <h3 className="text-lg font-bold text-[#001B40] mb-2">Accept Online Payments</h3>
              <p className="text-xs text-[#576981] mb-5">
                Let your client pay this invoice by credit card.
              </p>

              <div className="flex items-center justify-between py-3 border-t border-b border-[#E1E6EB]">
                <span className="text-sm font-medium text-[#001B40]">
                  Turn on/off online payments
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={onlinePaymentsEnabled}
                  onClick={() => setOnlinePaymentsEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    onlinePaymentsEnabled ? 'bg-[#2FA84F]' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      onlinePaymentsEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="pt-4">
                <div className="text-xs font-semibold text-[#576981] uppercase tracking-wider mb-2">
                  Payment methods
                </div>
                <div className={`text-sm text-[#001B40] ${onlinePaymentsEnabled ? '' : 'opacity-50'}`}>
                  Credit and Debit Cards
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] font-bold text-[#1A1F71] bg-white border border-gray-200 rounded px-1.5 py-0.5">VISA</span>
                  <span className="text-[10px] font-bold text-[#EB001B] bg-white border border-gray-200 rounded px-1.5 py-0.5">MC</span>
                  <span className="text-[10px] font-bold text-[#1F72CD] bg-white border border-gray-200 rounded px-1.5 py-0.5">AMEX</span>
                </div>
              </div>

              <div className="mt-8 flex justify-end items-center gap-4">
                <button
                  type="button"
                  onClick={() => setSettingsView('main')}
                  className="text-sm font-semibold text-[#576981] hover:text-[#001B40]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setSettingsView('main')}
                  className="px-5 py-2 text-sm font-semibold text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {clientModal.open && (
        <QuickClientModal
          mode={clientModal.mode}
          initial={clientModal.initial}
          onSaved={(saved) => {
            setClients((prev) => {
              const idx = prev.findIndex((c) => c.id === saved.id)
              if (idx >= 0) {
                const next = [...prev]
                next[idx] = { ...prev[idx], ...saved }
                return next
              }
              return [saved, ...prev]
            })
            setSelectedClient(saved)
            setClientId(saved.id)
            if (!currencyTouchedRef.current && saved.currency) {
              setCurrency(saved.currency)
            }
            setClientModal({ open: false, mode: 'create' })
          }}
          onClose={() => setClientModal({ open: false, mode: 'create' })}
        />
      )}

      {/* Discard changes modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm</h3>
            <p className="text-sm text-gray-600 mb-6">
              You have unsaved changes to your invoice. Do you want to leave and discard your changes?
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDiscardModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowDiscardModal(false)
                  setIsDirty(false)
                  if (pendingNavRef.current) {
                    router.push(pendingNavRef.current)
                  }
                }}
                className="px-4 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
