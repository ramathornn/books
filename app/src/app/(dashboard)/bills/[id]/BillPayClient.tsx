'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface Props {
  billId: string
  billNumber: string
  currency: string
  amountDue: number
  bankAccounts: Array<{ id: string; label: string; currency: string }>
}

export default function BillPayClient({ billId, currency, amountDue, bankAccounts }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(amountDue.toFixed(2))
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || '')
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function pay() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/bills/${billId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(amount),
          paymentDate,
          bankAccountId,
          paymentMethod,
          reference,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Payment failed')
      }
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full px-4 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded"
      >
        Record payment
      </button>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-[#0075DD] p-4 space-y-3">
      <h3 className="text-sm font-semibold text-[#001B40]">Record payment</h3>
      {error && <div className="p-2 bg-[#FDECEA] text-[#BF2600] text-xs rounded">{error}</div>}

      <Field label="Amount">
        <input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={inputCls + ' font-mono text-right'}
        />
      </Field>
      <Field label="Date">
        <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputCls} />
      </Field>
      <Field label="From bank account">
        <select
          value={bankAccountId}
          onChange={(e) => setBankAccountId(e.target.value)}
          className={inputCls + ' bg-white'}
        >
          {bankAccounts.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label} {b.currency !== currency && `· ${b.currency}`}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Method">
        <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputCls + ' bg-white'}>
          {['Bank Transfer', 'Cheque', 'Cash', 'Credit Card', 'Interac E-Transfer', 'Other'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label="Reference (optional)">
        <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
      </Field>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E1E6EB]">
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm text-[#576981]">
          Cancel
        </button>
        <button
          onClick={pay}
          disabled={saving}
          className="px-4 py-1.5 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Posting…' : `Pay ${formatCurrency(parseFloat(amount) || 0, currency, { includeCode: false })}`}
        </button>
      </div>
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#576981] mb-1">{label}</span>
      {children}
    </label>
  )
}
