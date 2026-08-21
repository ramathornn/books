'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'

interface GLOption {
  id: string
  accountNumber: string
  accountName: string
  detailType: string
  currency: string
}

const ACCOUNT_TYPES: { value: string; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'wallet', label: 'Wallet (Wise, PayPal, etc.)' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void
}

export default function NewBankAccountDialog({ isOpen, onClose, onCreated }: Props) {
  const [glAccountId, setGlAccountId] = useState('')
  const [bankName, setBankName] = useState('')
  const [masked, setMasked] = useState('')
  const [accountHolder, setAccountHolder] = useState('')
  const [accountType, setAccountType] = useState('checking')
  const [statementClosingDay, setStatementClosingDay] = useState('')
  const [glAccounts, setGlAccounts] = useState<GLOption[]>([])
  const [createNewGL, setCreateNewGL] = useState(false)
  const [newGLNumber, setNewGLNumber] = useState('')
  const [newGLName, setNewGLName] = useState('')
  const [newGLCurrency, setNewGLCurrency] = useState('CAD')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setGlAccountId('')
    setBankName('')
    setMasked('')
    setAccountHolder('')
    setAccountType('checking')
    setStatementClosingDay('')
    setCreateNewGL(false)
    setNewGLNumber('')
    setNewGLName('')
    setNewGLCurrency('CAD')
    setError('')
    fetch('/api/gl-accounts?class=asset')
      .then((r) => r.json())
      .then((d) =>
        setGlAccounts(
          (d.data || []).filter((a: GLOption & { isReconcilable?: boolean; bankAccount?: unknown }) => {
            const dt = a.detailType || ''
            return dt === 'Bank' || dt === 'Credit Card' || dt === 'Bank' || dt === ''
          })
        )
      )
      .catch(() => {})
    fetch('/api/gl-accounts?class=liability')
      .then((r) => r.json())
      .then((d) =>
        setGlAccounts((prev) => [
          ...prev,
          ...(d.data || []).filter(
            (a: GLOption) => a.detailType === 'Credit Card'
          ),
        ])
      )
      .catch(() => {})
  }, [isOpen])

  async function ensureGL(): Promise<string | null> {
    if (!createNewGL) return glAccountId
    if (!newGLNumber.trim() || !newGLName.trim()) {
      setError('GL account number and name are required.')
      return null
    }
    const isCC = accountType === 'credit_card'
    const res = await fetch('/api/gl-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountNumber: newGLNumber.trim(),
        accountName: newGLName.trim(),
        accountClass: isCC ? 'liability' : 'asset',
        accountSubclass: isCC ? 'Credit Card' : 'Bank',
        currency: newGLCurrency,
        isReconcilable: true,
      }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error || 'Failed to create GL account')
      return null
    }
    const created = await res.json()
    return created.id
  }

  async function handleSave() {
    setError('')
    setSaving(true)
    try {
      const resolvedId = await ensureGL()
      if (!resolvedId) {
        setSaving(false)
        return
      }
      if (!bankName.trim()) {
        setError('Bank name is required.')
        setSaving(false)
        return
      }

      const res = await fetch('/api/bank-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          glAccountId: resolvedId,
          bankName: bankName.trim(),
          accountNumberMasked: masked,
          accountHolder,
          accountType,
          statementClosingDay: statementClosingDay || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Bank Account">
      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">
            Linked GL Account <span className="text-[#BF2600]">*</span>
          </label>
          {!createNewGL ? (
            <>
              <select
                value={glAccountId}
                onChange={(e) => setGlAccountId(e.target.value)}
                className="w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
              >
                <option value="">— Select GL account —</option>
                {glAccounts.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.accountNumber} — {g.accountName} ({g.currency})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setCreateNewGL(true)}
                className="mt-1 text-xs text-[#0075DD] hover:underline"
              >
                + Create new GL account
              </button>
            </>
          ) : (
            <div className="space-y-2 p-3 bg-[#F5F7FA] rounded">
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newGLNumber}
                  onChange={(e) => setNewGLNumber(e.target.value)}
                  placeholder="Number (e.g. 1150)"
                  className="h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
                />
                <select
                  value={newGLCurrency}
                  onChange={(e) => setNewGLCurrency(e.target.value)}
                  className="h-9 px-3 border border-[#E1E6EB] rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
                >
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="AUD">AUD</option>
                </select>
              </div>
              <input
                value={newGLName}
                onChange={(e) => setNewGLName(e.target.value)}
                placeholder="Account name (e.g. RBC Chequing)"
                className="w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
              />
              <button
                type="button"
                onClick={() => setCreateNewGL(false)}
                className="text-xs text-[#0075DD] hover:underline"
              >
                ← Use existing GL account
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Bank / Provider" required>
            <input
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="RBC, Wise, etc."
              className={inputCls}
            />
          </Field>
          <Field label="Account Type">
            <select
              value={accountType}
              onChange={(e) => setAccountType(e.target.value)}
              className={inputCls + ' bg-white'}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Last 4 / Masked #">
            <input
              value={masked}
              onChange={(e) => setMasked(e.target.value)}
              placeholder="3292"
              className={inputCls}
            />
          </Field>
          <Field label="Statement closing day">
            <input
              type="number"
              min={1}
              max={31}
              value={statementClosingDay}
              onChange={(e) => setStatementClosingDay(e.target.value)}
              placeholder="e.g. 28"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="Account Holder">
          <input
            value={accountHolder}
            onChange={(e) => setAccountHolder(e.target.value)}
            placeholder="Acme Inc."
            className={inputCls}
          />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#E1E6EB]">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Account'}
        </button>
      </div>
    </Modal>
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
