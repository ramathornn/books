'use client'

import { useState, useEffect, useCallback, useRef, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { CompanyInfo } from '@/lib/company'
import ClientPickerDropdown from '@/components/client/ClientPickerDropdown'
import QuickClientModal from '@/components/client/QuickClientModal'
import AutoTextarea from '@/components/ui/AutoTextarea'

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

interface EstimateData {
  id: string
  clientId: string
  dateIssued: string
  estimateNumber: string
  currency: string
  notes: string
  terms: string
  status: string
  client: ClientData
  lineItems: {
    id: string
    title: string
    description: string
    rate: number | string
    quantity: number | string
    lineTotal: number
    taxCodes: string[]
    sortOrder: number
  }[]
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

function fmtPlain(amount: number) {
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const prefix = amount < 0 ? '-' : ''
  return `${prefix}${formatted}`
}

export default function EditEstimatePage({
  params,
  company,
}: {
  params: Promise<{ id: string }>
  company: CompanyInfo
}) {
  const { id } = use(params)
  const router = useRouter()

  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const pendingNavRef = useRef<string | null>(null)

  const [clientId, setClientId] = useState('')
  const [clients, setClients] = useState<ClientData[]>([])
  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null)
  const [clientModal, setClientModal] = useState<{
    open: boolean
    mode: 'create' | 'edit'
    initial?: ClientData
  }>({ open: false, mode: 'create' })

  const [estimateDate, setEstimateDate] = useState('')
  const [estimateNumber, setEstimateNumber] = useState('')
  const [currency, setCurrency] = useState('CAD')
  const [notes, setNotes] = useState('')
  const [terms, setTerms] = useState('')
  const [status, setStatus] = useState('draft')

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { id: generateId(), title: '', description: '', rate: 0, quantity: 1, taxCodes: ['GST'] },
  ])

  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [activeItemDropdown, setActiveItemDropdown] = useState<string | null>(null)

  const [acceptPayments, setAcceptPayments] = useState(false)
  const [makeRecurring, setMakeRecurring] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/estimates/${id}`).then((res) => res.json()),
      fetch('/api/clients?limit=100').then((res) => res.json()),
      fetch('/api/items?limit=100').then((res) => res.json()),
    ])
      .then(([estimate, clientsRes, itemsRes]: [EstimateData, { data?: ClientData[] }, { data?: CatalogItem[] }]) => {
        const clientList = Array.isArray(clientsRes) ? clientsRes : clientsRes.data || []
        setClients(clientList)
        setCatalogItems(Array.isArray(itemsRes) ? itemsRes : itemsRes.data || [])
        setClientId(estimate.clientId)
        setSelectedClient(estimate.client)
        setEstimateDate(new Date(estimate.dateIssued).toISOString().split('T')[0])
        setEstimateNumber(estimate.estimateNumber)
        setCurrency(estimate.currency || 'CAD')
        setNotes(estimate.notes || '')
        setTerms(estimate.terms || '')
        setStatus(estimate.status)
        setLineItems(
          estimate.lineItems.map((item) => ({
            id: item.id || generateId(),
            title: item.title || '',
            description: item.description || '',
            rate: Number(item.rate),
            quantity: Number(item.quantity),
            taxCodes: item.taxCodes || [],
          }))
        )
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load estimate')
        setLoading(false)
      })
  }, [id])

  // Track dirty
  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (!loading && !initialLoadDone.current) {
      initialLoadDone.current = true
      return
    }
    if (initialLoadDone.current) {
      setIsDirty(true)
    }
  }, [clientId, notes, terms, lineItems, estimateDate, currency, loading])

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])


  const subtotal = lineItems.reduce((sum, item) => sum + item.rate * item.quantity, 0)
  const taxAmount = lineItems.reduce((sum, item) => {
    if (item.taxCodes.some((tc) => tc.toUpperCase().includes('GST'))) {
      return sum + item.rate * item.quantity * 0.05
    }
    return sum
  }, 0)
  const total = subtotal + taxAmount

  function addLine() {
    setLineItems([
      ...lineItems,
      { id: generateId(), title: '', description: '', rate: 0, quantity: 1, taxCodes: ['GST'] },
    ])
  }

  function removeLine(itemId: string) {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((item) => item.id !== itemId))
    }
  }

  function duplicateLine(itemId: string) {
    const idx = lineItems.findIndex((item) => item.id === itemId)
    if (idx === -1) return
    const copy = { ...lineItems[idx], id: generateId(), taxCodes: [...lineItems[idx].taxCodes] }
    const next = [...lineItems]
    next.splice(idx + 1, 0, copy)
    setLineItems(next)
  }

  function updateLine(itemId: string, field: keyof LineItem, value: string | number | string[]) {
    setLineItems(
      lineItems.map((item) => (item.id === itemId ? { ...item, [field]: value } : item))
    )
  }

  function toggleGst(itemId: string) {
    setLineItems(
      lineItems.map((item) => {
        if (item.id !== itemId) return item
        const hasGst = item.taxCodes.includes('GST')
        return {
          ...item,
          taxCodes: hasGst ? item.taxCodes.filter((tc) => tc !== 'GST') : [...item.taxCodes, 'GST'],
        }
      })
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
      pendingNavRef.current = `/estimates/${id}`
      setShowDiscardModal(true)
    } else {
      router.push(`/estimates/${id}`)
    }
  }, [isDirty, id, router])

  const handleSave = useCallback(
    async (asDraft: boolean) => {
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
        const res = await fetch(`/api/estimates/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientId,
            dateIssued: estimateDate,
            currency,
            notes,
            terms,
            status: asDraft ? 'draft' : status === 'draft' ? 'sent' : status,
            lineItems: validLines.map((item, index) => ({
              title: item.title,
              description: item.description,
              rate: item.rate,
              quantity: item.quantity,
              taxCodes: item.taxCodes,
              sortOrder: index,
            })),
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to update estimate')
        }

        setIsDirty(false)
        router.push(`/estimates/${id}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong')
      } finally {
        setSaving(false)
      }
    },
    [clientId, estimateDate, currency, notes, terms, status, lineItems, id, router]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#2FA84F]" />
      </div>
    )
  }

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Edit Estimate</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="px-4 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className="px-4 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save & Send'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[#FFEBE6] text-[#BF2600] text-sm rounded-md">{error}</div>
      )}

      <div className="flex gap-6">
        <div className="flex-1">
          <div className="bg-white rounded-lg border border-gray-200 shadow-md p-8">
            {/* Company header */}
            <div className="flex justify-between mb-8">
              <div>
                <h2 className="text-3xl font-black text-[#1A3353] tracking-tight leading-none">{company.logoInitials}</h2>
              </div>
              <div className="text-right text-sm text-gray-600">
                <div className="font-semibold text-gray-900">{company.legalName}</div>
                <div>+1-555-000-0000</div>
                <div>123 Main Street</div>
                <div>Calgary, AB T0A0A0</div>
              </div>
            </div>

            {/* Prepared For + meta */}
            <div className="flex justify-between mb-8">
              <div className="w-64">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Prepared For</div>
                <ClientPickerDropdown
                  clients={clients}
                  selectedClient={selectedClient}
                  onSelect={(client) => {
                    setSelectedClient(client)
                    setClientId(client.id)
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
                  <div className="mt-2 text-sm text-gray-600 whitespace-pre-line">
                    {selectedClient.address}
                  </div>
                )}
              </div>

              <div className="w-80">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <label className="text-sm text-gray-500 self-center">Estimate Date</label>
                  <input
                    type="date"
                    value={estimateDate}
                    onChange={(e) => setEstimateDate(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                  />
                  <label className="text-sm text-gray-500 self-center">Estimate Number</label>
                  <input
                    type="text"
                    value={estimateNumber}
                    readOnly
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-gray-50 text-gray-500"
                  />
                  <label className="text-sm text-gray-500 self-center">Currency</label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                  >
                    <option value="CAD">CAD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                  <label className="text-sm text-gray-500 self-center">Estimate Total ({currency})</label>
                  <div className="text-2xl font-bold text-gray-900">{fmtMoney(total, currency)}</div>
                </div>
              </div>
            </div>

            {/* Line items */}
            <table className="w-full mb-4">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">Description</th>
                  <th className="text-right py-1 text-xs font-medium text-gray-500 uppercase tracking-wider w-28">Rate</th>
                  <th className="text-right py-1 text-xs font-medium text-gray-500 uppercase tracking-wider w-16">Qty</th>
                  <th className="text-right py-1 text-xs font-medium text-gray-500 uppercase tracking-wider w-28">Line Total</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item) => {
                  const lineTotal = item.rate * item.quantity
                  const hasGst = item.taxCodes.includes('GST')
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
                            className="w-full px-2 py-1 border border-gray-200 rounded text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F] resize-none"
                          />
                          <AutoTextarea
                            minRows={1}
                            value={item.description}
                            onChange={(e) => updateLine(item.id, 'description', e.target.value)}
                            placeholder="Description (optional)"
                            className="w-full px-2 py-1 border border-gray-200 rounded text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F] resize-none"
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
                            className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                          />
                          {hasGst && (
                            <div className="text-right mt-0.5">
                              <span className="text-xs text-blue-600 font-medium">+GST</span>
                            </div>
                          )}
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
                          className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm text-right focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                        />
                      </td>
                      <td className="py-1 text-right text-sm text-gray-900 pr-2">{fmtMoney(lineTotal, currency)}</td>
                      <td className="py-1 text-center">
                        <div className="flex items-center gap-1">
                          <label className="flex items-center gap-1 cursor-pointer" title="Toggle GST">
                            <input
                              type="checkbox"
                              checked={hasGst}
                              onChange={() => toggleGst(item.id)}
                              className="rounded border-gray-300 text-[#2FA84F] focus:ring-[#2FA84F] h-3.5 w-3.5"
                            />
                          </label>
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

            <button onClick={addLine} className="text-sm text-[#2FA84F] hover:text-[#268f3e] font-medium mb-6">
              + Add a Line
            </button>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-64">
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="text-gray-900">{fmtPlain(subtotal)}</span>
                </div>
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-gray-500">Tax</span>
                  <span className="text-gray-900">{fmtPlain(taxAmount)}</span>
                </div>
                <div className="flex justify-between py-2 text-sm border-t-2 border-gray-900 font-bold text-[#2FA84F]">
                  <span>Estimate Total ({currency})</span>
                  <span>{fmtMoney(total, currency)}</span>
                </div>
              </div>
            </div>

            {/* Notes & Terms — inline, borderless, FB-style, stacked */}
            <div className="mt-10 space-y-6">
              <div>
                <div className="text-[15px] font-semibold text-[#0075DD] mb-1">
                  Notes
                </div>
                <AutoTextarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Enter notes (optional)"
                  minRows={4}
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
                  minRows={4}
                  className="w-full bg-transparent border-0 p-0 text-sm text-[#001B40] placeholder-[#8C9BAB] focus:outline-none focus:ring-0 resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-64 flex-shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 p-4 sticky top-20">
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Settings</h3>
            <p className="text-xs text-gray-500 mb-4">For This Estimate</p>
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-700">Accept Online Payments</div>
                <button
                  onClick={() => setAcceptPayments(!acceptPayments)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    acceptPayments ? 'bg-[#2FA84F]' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={acceptPayments}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    acceptPayments ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              <div className="border-t border-gray-100 pt-3">
                <button className="w-full text-left text-sm text-[#2FA84F] hover:underline flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Customize Estimate Style
                </button>
                <p className="text-xs text-gray-400 ml-6">Change Template, Color, and Font</p>
              </div>
              <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                <div>
                  <div className="text-sm text-gray-700">Make Recurring</div>
                  <div className="text-xs text-gray-400">Set your clients automatically</div>
                </div>
                <button
                  onClick={() => setMakeRecurring(!makeRecurring)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                    makeRecurring ? 'bg-[#2FA84F]' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={makeRecurring}
                >
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                    makeRecurring ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Discard changes modal */}
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
            setClientModal({ open: false, mode: 'create' })
          }}
          onClose={() => setClientModal({ open: false, mode: 'create' })}
        />
      )}

      {showDiscardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Confirm</h3>
            <p className="text-sm text-gray-600 mb-6">
              You have unsaved changes to your estimate. Do you want to leave and discard your changes?
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
