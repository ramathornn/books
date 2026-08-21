'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface VendorOption {
  id: string
  name: string
  defaultCategoryId: string | null
  defaultTaxCodeId: string | null
}

interface GLAccountOption {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
}

interface TaxCodeOption {
  id: string
  code: string
  name: string
  rate: number
}

interface Line {
  description: string
  amount: string
  taxCodeId: string
  categoryGlAccountId: string
}

interface Props {
  mode: 'new' | 'edit'
  bill?: {
    id: string
    billNumber: string
    vendorId: string | null
    billDate: string
    dueDate: string
    currency: string
    notes: string
    reference: string
    status: string
    lines: Array<{
      description: string
      amount: number
      taxAmount: number
      taxCodeId: string | null
      categoryGlAccountId: string | null
    }>
  }
  vendors: VendorOption[]
  glAccounts: GLAccountOption[]
  taxCodes: TaxCodeOption[]
}

function blankLine(): Line {
  return { description: '', amount: '', taxCodeId: '', categoryGlAccountId: '' }
}

export default function BillForm({ mode, bill, vendors, glAccounts, taxCodes }: Props) {
  const router = useRouter()
  const [billNumber, setBillNumber] = useState(bill?.billNumber || '')
  const [vendorId, setVendorId] = useState(bill?.vendorId || '')
  const [billDate, setBillDate] = useState(bill?.billDate.slice(0, 10) || new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(
    bill?.dueDate.slice(0, 10) ||
      new Date(new Date().getTime() + 30 * 86400000).toISOString().slice(0, 10)
  )
  const [currency, setCurrency] = useState(bill?.currency || 'CAD')
  const [reference, setReference] = useState(bill?.reference || '')
  const [notes, setNotes] = useState(bill?.notes || '')
  const [lines, setLines] = useState<Line[]>(
    bill?.lines.length
      ? bill.lines.map((l) => ({
          description: l.description,
          amount: String(l.amount || ''),
          taxCodeId: l.taxCodeId || '',
          categoryGlAccountId: l.categoryGlAccountId || '',
        }))
      : [blankLine(), blankLine()]
  )
  const [postOnSave, setPostOnSave] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const taxLookup = useMemo(() => new Map(taxCodes.map((t) => [t.id, t])), [taxCodes])

  function setLine(i: number, l: Partial<Line>) {
    setLines((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...l } : x)))
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine()])
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  const totals = useMemo(() => {
    let subtotal = 0
    let tax = 0
    const breakdown = lines.map((l) => {
      const amt = parseFloat(l.amount) || 0
      const tc = l.taxCodeId ? taxLookup.get(l.taxCodeId) : null
      const taxAmt = tc ? amt * Number(tc.rate) : 0
      subtotal += amt
      tax += taxAmt
      return { net: amt, tax: taxAmt }
    })
    return { subtotal, tax, total: subtotal + tax, breakdown }
  }, [lines, taxLookup])

  async function save(asStatus: 'draft' | 'open') {
    setError('')
    if (!vendorId) {
      setError('Vendor is required.')
      return
    }
    const validLines = lines.filter((l) => parseFloat(l.amount) > 0)
    if (validLines.length === 0) {
      setError('Add at least one line with an amount.')
      return
    }
    if (asStatus === 'open' && validLines.some((l) => !l.categoryGlAccountId)) {
      setError('Each line needs a category GL account before posting.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        billNumber: billNumber || undefined,
        vendorId,
        billDate,
        dueDate,
        currency,
        reference,
        notes,
        status: asStatus,
        lines: validLines.map((l, idx) => {
          const amt = parseFloat(l.amount) || 0
          const tc = l.taxCodeId ? taxLookup.get(l.taxCodeId) : null
          const taxAmt = tc ? amt * Number(tc.rate) : 0
          return {
            description: l.description,
            amount: amt,
            taxAmount: Math.round(taxAmt * 100) / 100,
            categoryGlAccountId: l.categoryGlAccountId || null,
            taxCodeId: l.taxCodeId || null,
            sortOrder: idx,
          }
        }),
      }
      const url = mode === 'edit' ? `/api/bills/${bill!.id}` : '/api/bills'
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
      router.push('/bills')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // Group GL accounts by class for the picker
  const glByClass = useMemo(() => {
    return glAccounts.reduce((acc, g) => {
      if (!acc[g.accountClass]) acc[g.accountClass] = []
      acc[g.accountClass].push(g)
      return acc
    }, {} as Record<string, GLAccountOption[]>)
  }, [glAccounts])

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <Link href="/bills" className="text-xs text-[#0075DD] hover:underline">
            ← Bills
          </Link>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {mode === 'edit' ? 'Edit Bill' : 'New Bill'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/bills" className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]">
            Cancel
          </Link>
          <button
            onClick={() => save('draft')}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] disabled:opacity-50"
          >
            Save as draft
          </button>
          <button
            onClick={() => save('open')}
            disabled={saving}
            className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {saving ? 'Posting…' : 'Save & Post'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Field label="Vendor" required>
                <select
                  value={vendorId}
                  onChange={(e) => {
                    setVendorId(e.target.value)
                    const v = vendors.find((x) => x.id === e.target.value)
                    if (v?.defaultTaxCodeId && lines.length > 0 && !lines[0].taxCodeId) {
                      setLines((prev) => prev.map((l) => ({ ...l, taxCodeId: v.defaultTaxCodeId! })))
                    }
                  }}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">— Select vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Bill #">
                <input
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="auto"
                  className={inputCls + ' font-mono'}
                />
              </Field>
              <Field label="Currency">
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  {['CAD', 'USD', 'EUR', 'GBP', 'AUD'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Bill date">
                <input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Due date">
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Reference / Vendor PO">
                <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
              </Field>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
            <h3 className="text-sm font-semibold text-[#001B40] mb-3">Lines</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E1E6EB]">
                    <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Description</th>
                    <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Category</th>
                    <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Tax</th>
                    <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">Amount</th>
                    <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">Tax</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const breakdown = totals.breakdown[i]
                    return (
                      <tr key={i} className="border-b border-[#E1E6EB]">
                        <td className="py-1 px-1">
                          <input
                            value={l.description}
                            onChange={(e) => setLine(i, { description: e.target.value })}
                            placeholder="Description"
                            className="w-full h-9 px-2 text-sm border border-[#E1E6EB] rounded"
                          />
                        </td>
                        <td className="py-1 px-1">
                          <select
                            value={l.categoryGlAccountId}
                            onChange={(e) => setLine(i, { categoryGlAccountId: e.target.value })}
                            className="w-full h-9 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                          >
                            <option value="">— Select —</option>
                            {Object.entries(glByClass).map(([cls, accts]) => (
                              <optgroup key={cls} label={cls.charAt(0).toUpperCase() + cls.slice(1)}>
                                {accts.map((g) => (
                                  <option key={g.id} value={g.id}>
                                    {g.accountNumber} · {g.accountName}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 px-1">
                          <select
                            value={l.taxCodeId}
                            onChange={(e) => setLine(i, { taxCodeId: e.target.value })}
                            className="w-full h-9 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                          >
                            <option value="">No tax</option>
                            {taxCodes.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} {t.rate > 0 && `(${(t.rate * 100).toFixed(0)}%)`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 px-1">
                          <input
                            type="number"
                            step="0.01"
                            value={l.amount}
                            onChange={(e) => setLine(i, { amount: e.target.value })}
                            placeholder="0.00"
                            className="w-28 h-9 px-2 text-sm border border-[#E1E6EB] rounded text-right font-mono"
                          />
                        </td>
                        <td className="py-1 px-1 text-right text-xs text-[#576981] font-mono">
                          {breakdown ? formatCurrency(breakdown.tax, currency, { includeCode: false }) : '—'}
                        </td>
                        <td className="py-1 px-1">
                          {lines.length > 1 && (
                            <button
                              onClick={() => removeLine(i)}
                              className="text-[#576981] hover:text-[#BF2600] text-sm px-1"
                            >
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <button
              onClick={addLine}
              className="mt-3 text-sm text-[#0075DD] hover:underline"
            >
              + Add line
            </button>
          </div>

          <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className={inputCls + ' h-auto py-2 resize-none'}
              />
            </Field>
          </div>
        </div>

        <div>
          <div className="bg-white rounded-lg border border-[#E1E6EB] p-5 sticky top-6">
            <h3 className="text-sm font-semibold text-[#001B40] mb-3">Totals</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-[#576981]">Subtotal</dt>
                <dd className="font-mono text-[#001B40]">
                  {formatCurrency(totals.subtotal, currency, { includeCode: false })}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[#576981]">Tax</dt>
                <dd className="font-mono text-[#001B40]">
                  {formatCurrency(totals.tax, currency, { includeCode: false })}
                </dd>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[#E1E6EB]">
                <dt className="font-semibold text-[#001B40]">Total</dt>
                <dd className="font-mono font-semibold text-[#001B40]">
                  {formatCurrency(totals.total, currency, { includeCode: false })}
                </dd>
              </div>
            </dl>
          </div>
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
