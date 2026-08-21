'use client'

import { useEffect, useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import AttachmentList from '@/components/ui/AttachmentList'
import type { BankTxRow } from './types'

export interface DrawerData {
  tx: BankTxRow
  mode: 'categorize' | 'view'
}

interface Props {
  data: DrawerData
  currentAccount: {
    id: string
    glAccountNumber: string
    glAccountName: string
    currency: string
    accountType: string
  }
  glAccounts: Array<{ id: string; accountNumber: string; accountName: string; accountClass: string; currency: string }>
  vendors: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string; groupName: string; glAccountId: string | null }>
  taxCodes: Array<{ id: string; code: string; name: string; rate: number; appliesTo: string }>
  openInvoices: Array<{
    id: string
    invoiceNumber: string
    clientName: string
    dateIssued: string
    total: number
    amountDue: number
    currency: string
  }>
  recentExpenses: Array<{
    id: string
    date: string
    description: string
    total: number
    currency: string
  }>
  // Payments already cleared to undeposited funds (CAD basis stored). A real bank
  // deposit can move these from clearing to this account — DR bank / CR clearing.
  clearedPayments: Array<{
    id: string
    invoiceNumber: string
    clientName: string
    paymentDate: string
    amount: number
    currency: string
    cadAmount: number
  }>
  bankAccounts: Array<{
    id: string
    accountNumber: string
    accountName: string
    currency: string
  }>
  onClose: () => void
  onSaved: () => void
}

type Mode = 'categorize' | 'match' | 'transfer'

export default function CategorizeDrawer({
  data,
  currentAccount,
  glAccounts,
  vendors,
  taxCodes,
  openInvoices,
  recentExpenses,
  clearedPayments,
  bankAccounts,
  onClose,
  onSaved,
}: Props) {
  const tx = data.tx
  const isOut = Number(tx.amount) < 0
  const abs = Math.abs(Number(tx.amount))

  const [mode, setMode] = useState<Mode>('categorize')
  const [categoryGlAccountId, setCategoryGlAccountId] = useState(tx.categoryGlAccountId || '')
  const [vendorId, setVendorId] = useState(tx.vendorId || '')
  const [taxCodeId, setTaxCodeId] = useState(tx.taxCodeId || '')
  const [memo, setMemo] = useState(tx.memo || '')
  const [payee, setPayee] = useState(tx.payee || '')
  const [matchInvoiceId, setMatchInvoiceId] = useState(tx.matchedInvoiceId || '')
  const [matchExpenseId, setMatchExpenseId] = useState(tx.matchedExpenseId || '')
  const [matchPaymentId, setMatchPaymentId] = useState(tx.matchedPaymentId || '')
  // Transfer pairing: pick the other side (an opposite-sign pending line in
  // another account). FX difference is booked automatically when currencies differ.
  const [transferDestId, setTransferDestId] = useState('') // destination bank account id
  const [counterpartId, setCounterpartId] = useState('')
  const [fxGlAccountId, setFxGlAccountId] = useState('')
  const [destRows, setDestRows] = useState<BankTxRow[]>([])
  const [loadingDest, setLoadingDest] = useState(false)
  const [saving, setSaving] = useState(false)
  const [excluding, setExcluding] = useState(false)
  const [error, setError] = useState('')
  // Suggest-first vendor resolution: a "create vendor X" name offered when no
  // existing vendor confidently matches, and the flag that we'll create it on save.
  const [vendorSuggestName, setVendorSuggestName] = useState<string | null>(null)
  const [createVendorName, setCreateVendorName] = useState<string | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // Suggested invoice matches: same currency + amount within 1 cent + within ±10 days
  const suggestedInvoices = useMemo(() => {
    if (!isOut) {
      // money in — suggest invoice payments
      return openInvoices
        .filter((i) => i.currency === currentAccount.currency)
        .filter((i) => Math.abs(i.amountDue - abs) < 0.01 || Math.abs(i.total - abs) < 0.01)
        .slice(0, 5)
    }
    return []
  }, [openInvoices, currentAccount.currency, abs, isOut])

  // Suggested undeposited-funds clears: a real deposit for a Payment already
  // settled to clearing. Money-in, same currency, native amount within 1 cent,
  // payment date within ±10 days. Clearing it moves cash from clearing → bank.
  const suggestedPayments = useMemo(() => {
    if (isOut) return []
    const txT = new Date(tx.transactionDate).getTime()
    return clearedPayments
      .filter((p) => p.currency === currentAccount.currency)
      .filter((p) => Math.abs(p.amount - abs) < 0.01)
      .filter((p) => {
        const diff = Math.abs(new Date(p.paymentDate).getTime() - txT) / (1000 * 60 * 60 * 24)
        return diff <= 10
      })
      .slice(0, 5)
  }, [clearedPayments, currentAccount.currency, abs, isOut, tx.transactionDate])

  // Suggested expense matches: same currency + amount within 1 cent + within ±5 days
  const suggestedExpenses = useMemo(() => {
    if (isOut) {
      const target = abs
      const txDate = new Date(tx.transactionDate)
      return recentExpenses
        .filter((e) => e.currency === currentAccount.currency)
        .filter((e) => Math.abs(e.total - target) < 0.01)
        .filter((e) => {
          const d = new Date(e.date)
          const diff = Math.abs(d.getTime() - txDate.getTime()) / (1000 * 60 * 60 * 24)
          return diff <= 5
        })
        .slice(0, 5)
    }
    return []
  }, [recentExpenses, currentAccount.currency, abs, isOut, tx.transactionDate])

  // Suggest a vendor (and its default category) once, when opening an
  // uncategorized line with no vendor yet. Never overrides a rule-suggested or
  // user-chosen value — uses functional setState so it only fills empties.
  useEffect(() => {
    if (data.mode !== 'categorize' || tx.vendorId) return
    let cancelled = false
    fetch(`/api/bank-transactions/${tx.id}/vendor-suggest`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        if (d.vendorId) {
          setVendorId((prev) => prev || d.vendorId)
          if (d.defaultCategoryGlAccountId) {
            setCategoryGlAccountId((prev) => prev || d.defaultCategoryGlAccountId)
          }
        } else if (d.suggestName) {
          setVendorSuggestName(d.suggestName)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [tx.id, tx.vendorId, data.mode])

  // Load the destination account's pending lines (for picking the counterpart).
  useEffect(() => {
    if (mode !== 'transfer' || !transferDestId) {
      setDestRows([])
      return
    }
    let cancelled = false
    setLoadingDest(true)
    setCounterpartId('')
    fetch(`/api/bank-transactions?accountId=${transferDestId}&status=pending&limit=200`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setDestRows((d.data || []) as BankTxRow[])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingDest(false)
      })
    return () => {
      cancelled = true
    }
  }, [mode, transferDestId])

  const destAccount = bankAccounts.find((b) => b.id === transferDestId) || null
  // Counterpart candidates: opposite-sign pending lines, closest date first.
  const counterpartCandidates = useMemo(() => {
    const txT = new Date(tx.transactionDate).getTime()
    return destRows
      .filter((r) => Number(r.amount) < 0 !== isOut)
      .sort(
        (a, b) =>
          Math.abs(new Date(a.transactionDate).getTime() - txT) -
          Math.abs(new Date(b.transactionDate).getTime() - txT)
      )
  }, [destRows, isOut, tx.transactionDate])
  const counterpart = counterpartCandidates.find((r) => r.id === counterpartId) || null

  // Source = the outflow, Dest = the inflow.
  const counterpartAbs = counterpart ? Math.abs(Number(counterpart.amount)) : 0
  const srcAmt = isOut ? abs : counterpartAbs
  const dstAmt = isOut ? counterpartAbs : abs
  const srcCcy = isOut ? currentAccount.currency : destAccount?.currency || ''
  const dstCcy = isOut ? destAccount?.currency || '' : currentAccount.currency
  const crossCurrency = !!destAccount && destAccount.currency !== currentAccount.currency
  const fxDiff = counterpart ? Math.round((dstAmt - srcAmt) * 100) / 100 : 0
  const impliedRate = counterpart && srcAmt > 0 ? dstAmt / srcAmt : 0

  // Build the GL accounts list grouped for the category picker
  const glByClass = useMemo(() => {
    return glAccounts.reduce((acc, g) => {
      if (!acc[g.accountClass]) acc[g.accountClass] = []
      acc[g.accountClass].push(g)
      return acc
    }, {} as Record<string, typeof glAccounts>)
  }, [glAccounts])

  // Filter to expense categories for outflow, income for inflow
  const relevantClasses = isOut ? ['expense', 'liability', 'asset'] : ['income', 'liability', 'equity']

  async function categorize() {
    setError('')
    if (!categoryGlAccountId) {
      setError('Please select a category.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/bank-transactions/${tx.id}/categorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryGlAccountId,
          vendorId: vendorId || null,
          createVendorName: createVendorName || undefined,
          taxCodeId: taxCodeId || null,
          memo,
          payee,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Categorize failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function match(target: 'invoice' | 'expense' | 'payment', targetId: string) {
    setError('')
    setSaving(true)
    try {
      const res = await fetch(`/api/bank-transactions/${tx.id}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, targetId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Match failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Match failed')
    } finally {
      setSaving(false)
    }
  }

  async function transfer() {
    setError('')
    if (!counterpartId) {
      setError('Select the matching transaction in the other account.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/bank-transactions/${tx.id}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counterpartTransactionId: counterpartId,
          fxGlAccountId: fxGlAccountId || undefined,
          memo,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Transfer failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transfer failed')
    } finally {
      setSaving(false)
    }
  }

  async function exclude() {
    if (!confirm('Exclude this transaction? It will be hidden from the books and not posted to a journal entry.')) return
    setExcluding(true)
    try {
      const res = await fetch(`/api/bank-transactions/${tx.id}/exclude`, { method: 'POST' })
      if (!res.ok) throw new Error('Exclude failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Exclude failed')
    } finally {
      setExcluding(false)
    }
  }

  async function unpost() {
    if (!confirm('Move this transaction back to Pending? Its journal entry will be reversed.')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/bank-transactions/${tx.id}/unpost`, { method: 'POST' })
      if (!res.ok) throw new Error('Unpost failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unpost failed')
    } finally {
      setSaving(false)
    }
  }

  const isPosted = tx.status === 'posted'
  const isExcluded = tx.status === 'excluded'

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-[520px] bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E1E6EB]">
          <div>
            <h2 className="text-base font-semibold text-[#001B40]">
              {isPosted ? 'Posted transaction' : isExcluded ? 'Excluded transaction' : 'Categorize transaction'}
            </h2>
            <p className="text-xs text-[#576981]">
              {tx.transactionDate.slice(0, 10)} · {currentAccount.glAccountName}
            </p>
          </div>
          <button onClick={onClose} className="text-[#576981] hover:text-[#001B40]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 bg-[#F5F7FA] border-b border-[#E1E6EB]">
          <div className="text-xs text-[#576981] uppercase mb-1">{isOut ? 'Money Out' : 'Money In'}</div>
          <div className={`text-2xl font-semibold ${isOut ? 'text-[#BF2600]' : 'text-[#216E39]'}`}>
            {formatCurrency(abs, currentAccount.currency, { includeCode: false })}
          </div>
          <div className="text-sm text-[#001B40] mt-1">{tx.description}</div>
        </div>

        {!isPosted && !isExcluded && (
          <div className="px-5 pt-3">
            <div className="flex gap-1 p-1 bg-[#F5F7FA] rounded">
              {([
                { v: 'categorize', label: 'Categorize' },
                { v: 'match', label: 'Match' },
                { v: 'transfer', label: 'Transfer' },
              ] as Array<{ v: Mode; label: string }>).map((t) => (
                <button
                  key={t.v}
                  onClick={() => setMode(t.v)}
                  className={`flex-1 px-3 py-1.5 text-sm rounded transition-colors ${
                    mode === t.v
                      ? 'bg-white text-[#001B40] shadow-sm font-medium'
                      : 'text-[#576981] hover:text-[#001B40]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
          )}

          {(isPosted || isExcluded) && (
            <div className="p-3 bg-[#F0F8FE] border border-[#0075DD] rounded text-sm">
              {isPosted
                ? 'This transaction has been posted to the ledger.'
                : 'This transaction is excluded.'}{' '}
              {tx.matchedInvoiceId && '(Linked to invoice)'}
              {tx.matchedExpenseId && '(Linked to expense)'}
            </div>
          )}

          {(!isPosted && !isExcluded) && mode === 'categorize' && (
            <>
              <Field label="Category (GL account)" required>
                <select
                  value={categoryGlAccountId}
                  onChange={(e) => setCategoryGlAccountId(e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">Select an account</option>
                  {Object.entries(glByClass)
                    .filter(([cls]) => relevantClasses.includes(cls))
                    .map(([cls, accts]) => (
                      <optgroup key={cls} label={cls.charAt(0).toUpperCase() + cls.slice(1)}>
                        {accts.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.accountNumber} · {g.accountName}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Vendor">
                  <select
                    value={vendorId}
                    onChange={(e) => {
                      setVendorId(e.target.value)
                      setCreateVendorName(null) // picking a vendor cancels a pending create
                    }}
                    className={inputCls + ' bg-white'}
                  >
                    <option value="">— None —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  {createVendorName ? (
                    <div className="mt-1 flex items-center gap-1 text-xs text-[#216E39]">
                      <span>Will create “{createVendorName}”</span>
                      <button
                        type="button"
                        onClick={() => setCreateVendorName(null)}
                        className="text-[#576981] hover:text-[#001B40] underline"
                      >
                        undo
                      </button>
                    </div>
                  ) : (
                    vendorSuggestName && !vendorId && (
                      <button
                        type="button"
                        onClick={() => setCreateVendorName(vendorSuggestName)}
                        className="mt-1 text-xs text-[#0075DD] hover:underline"
                      >
                        + Create vendor “{vendorSuggestName}”
                      </button>
                    )
                  )}
                </Field>
                <Field label="Tax code">
                  <select
                    value={taxCodeId}
                    onChange={(e) => setTaxCodeId(e.target.value)}
                    className={inputCls + ' bg-white'}
                  >
                    <option value="">— None —</option>
                    {taxCodes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.rate > 0 && `(${(t.rate * 100).toFixed(0)}%)`}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Payee">
                <input
                  value={payee}
                  onChange={(e) => setPayee(e.target.value)}
                  placeholder="Optional"
                  className={inputCls}
                />
              </Field>

              <Field label="Memo">
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={2}
                  className={inputCls + ' h-auto py-2'}
                />
              </Field>
            </>
          )}

          {(!isPosted && !isExcluded) && mode === 'match' && (
            <>
              <p className="text-xs text-[#576981]">
                Link this bank line to an existing record so we don&apos;t double-count it.
              </p>

              {isOut ? (
                <>
                  <h4 className="text-sm font-semibold text-[#001B40]">Suggested expense matches</h4>
                  {suggestedExpenses.length === 0 ? (
                    <div className="p-3 text-sm text-[#576981] bg-[#F5F7FA] rounded">
                      No close matches in your recent expenses.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {suggestedExpenses.map((e) => (
                        <li key={e.id} className="p-3 border border-[#E1E6EB] rounded">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-[#001B40] truncate">{e.description || '(no description)'}</div>
                              <div className="text-xs text-[#576981]">
                                {e.date.slice(0, 10)} · {formatCurrency(e.total, e.currency, { includeCode: false })}
                              </div>
                            </div>
                            <button
                              onClick={() => match('expense', e.id)}
                              disabled={saving}
                              className="px-3 py-1 text-xs font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                            >
                              Match
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="pt-3 border-t border-[#E1E6EB]">
                    <Field label="Or pick any expense by ID">
                      <select
                        value={matchExpenseId}
                        onChange={(e) => setMatchExpenseId(e.target.value)}
                        className={inputCls + ' bg-white'}
                      >
                        <option value="">— Select —</option>
                        {recentExpenses.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.date.slice(0, 10)} · {e.description.slice(0, 40)} ·{' '}
                            {formatCurrency(e.total, e.currency, { includeCode: false })}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {matchExpenseId && (
                      <button
                        onClick={() => match('expense', matchExpenseId)}
                        disabled={saving}
                        className="mt-2 px-4 py-1.5 text-sm font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                      >
                        Confirm match
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {(suggestedPayments.length > 0 || clearedPayments.length > 0) && (
                    <div className="pb-3 mb-1 border-b border-[#E1E6EB]">
                      <h4 className="text-sm font-semibold text-[#001B40]">
                        Recorded payments awaiting this deposit
                      </h4>
                      <p className="text-xs text-[#576981] mt-0.5 mb-2">
                        Cash you already recorded is sitting in Undeposited Funds. Match this deposit to it
                        to move it into this account — no new income, no FX.
                      </p>
                      {suggestedPayments.length === 0 ? (
                        <div className="p-3 text-sm text-[#576981] bg-[#F5F7FA] rounded">
                          No close matches in undeposited funds.
                        </div>
                      ) : (
                        <ul className="space-y-2">
                          {suggestedPayments.map((p) => (
                            <li key={p.id} className="p-3 border border-[#E1E6EB] rounded">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-medium text-[#001B40] truncate">
                                    {p.invoiceNumber ? `Invoice ${p.invoiceNumber} · ` : ''}
                                    {p.clientName}
                                  </div>
                                  <div className="text-xs text-[#576981]">
                                    Paid {p.paymentDate.slice(0, 10)} ·{' '}
                                    {formatCurrency(p.amount, p.currency, { includeCode: false })}
                                  </div>
                                </div>
                                <button
                                  onClick={() => match('payment', p.id)}
                                  disabled={saving}
                                  className="px-3 py-1 text-xs font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                                >
                                  Clear
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="pt-3 mt-3 border-t border-[#E1E6EB]">
                        <Field label="Or pick any undeposited payment">
                          <select
                            value={matchPaymentId}
                            onChange={(e) => setMatchPaymentId(e.target.value)}
                            className={inputCls + ' bg-white'}
                          >
                            <option value="">— Select —</option>
                            {clearedPayments.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.paymentDate.slice(0, 10)} ·{' '}
                                {p.invoiceNumber ? `${p.invoiceNumber} · ` : ''}
                                {p.clientName} ·{' '}
                                {formatCurrency(p.amount, p.currency, { includeCode: false })}
                              </option>
                            ))}
                          </select>
                        </Field>
                        {matchPaymentId && (
                          <button
                            onClick={() => match('payment', matchPaymentId)}
                            disabled={saving}
                            className="mt-2 px-4 py-1.5 text-sm font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                          >
                            Confirm deposit
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  <h4 className="text-sm font-semibold text-[#001B40]">Suggested invoice matches</h4>
                  {suggestedInvoices.length === 0 ? (
                    <div className="p-3 text-sm text-[#576981] bg-[#F5F7FA] rounded">
                      No close matches in your open invoices.
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {suggestedInvoices.map((i) => (
                        <li key={i.id} className="p-3 border border-[#E1E6EB] rounded">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-[#001B40] truncate">
                                Invoice {i.invoiceNumber} · {i.clientName}
                              </div>
                              <div className="text-xs text-[#576981]">
                                Issued {i.dateIssued.slice(0, 10)} · Due {formatCurrency(i.amountDue, i.currency, { includeCode: false })}
                              </div>
                            </div>
                            <button
                              onClick={() => match('invoice', i.id)}
                              disabled={saving}
                              className="px-3 py-1 text-xs font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                            >
                              Apply
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="pt-3 border-t border-[#E1E6EB]">
                    <Field label="Or pick any open invoice">
                      <select
                        value={matchInvoiceId}
                        onChange={(e) => setMatchInvoiceId(e.target.value)}
                        className={inputCls + ' bg-white'}
                      >
                        <option value="">— Select —</option>
                        {openInvoices.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.invoiceNumber} · {i.clientName} · Due{' '}
                            {formatCurrency(i.amountDue, i.currency, { includeCode: false })}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {matchInvoiceId && (
                      <button
                        onClick={() => match('invoice', matchInvoiceId)}
                        disabled={saving}
                        className="mt-2 px-4 py-1.5 text-sm font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded"
                      >
                        Confirm match
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {(!isPosted && !isExcluded) && mode === 'transfer' && (
            <>
              <p className="text-xs text-[#576981]">
                Money moving between two of your own accounts (e.g. Wise USD → Wise CAD).
                Pick the matching {isOut ? 'deposit' : 'withdrawal'} in the other account; we post one
                journal entry for both sides. If the accounts are different currencies, the difference
                is booked to Foreign Exchange Gain/Loss.
              </p>

              <Field label="Other account" required>
                <select
                  value={transferDestId}
                  onChange={(e) => setTransferDestId(e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">Select account</option>
                  {bankAccounts
                    .filter((b) => b.id !== currentAccount.id)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.accountNumber} · {b.accountName} ({b.currency})
                      </option>
                    ))}
                </select>
              </Field>

              {transferDestId && (
                <Field label={`Matching ${isOut ? 'deposit' : 'withdrawal'} in ${destAccount?.accountName || 'account'}`} required>
                  {loadingDest ? (
                    <div className="p-3 text-sm text-[#576981] bg-[#F5F7FA] rounded">Loading…</div>
                  ) : counterpartCandidates.length === 0 ? (
                    <div className="p-3 text-sm text-[#576981] bg-[#F5F7FA] rounded">
                      No pending {isOut ? 'deposits' : 'withdrawals'} in that account. Import that
                      account&apos;s CSV first, then pair them.
                    </div>
                  ) : (
                    <select
                      value={counterpartId}
                      onChange={(e) => setCounterpartId(e.target.value)}
                      className={inputCls + ' bg-white'}
                    >
                      <option value="">— Select —</option>
                      {counterpartCandidates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.transactionDate.slice(0, 10)} ·{' '}
                          {formatCurrency(Math.abs(Number(r.amount)), destAccount?.currency || '', { includeCode: false })}
                          {' · '}
                          {r.description.slice(0, 36)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}

              {counterpart && (
                <div className="p-3 bg-[#F5F7FA] border border-[#E1E6EB] rounded text-sm space-y-1">
                  <div className="flex justify-between">
                    <span className="text-[#576981]">Out</span>
                    <span className="text-[#001B40] font-medium">
                      {formatCurrency(srcAmt, srcCcy, { includeCode: false })} {srcCcy}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#576981]">In</span>
                    <span className="text-[#001B40] font-medium">
                      {formatCurrency(dstAmt, dstCcy, { includeCode: false })} {dstCcy}
                    </span>
                  </div>
                  {crossCurrency && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-[#576981]">Implied rate</span>
                        <span className="text-[#001B40]">
                          1 {srcCcy} = {impliedRate.toFixed(4)} {dstCcy}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#576981]">FX {fxDiff >= 0 ? 'gain' : 'loss'} booked</span>
                        <span className={fxDiff >= 0 ? 'text-[#216E39]' : 'text-[#BF2600]'}>
                          {formatCurrency(Math.abs(fxDiff), dstCcy, { includeCode: false })}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {counterpart && crossCurrency && (
                <Field label="FX gain/loss account">
                  <select
                    value={fxGlAccountId}
                    onChange={(e) => setFxGlAccountId(e.target.value)}
                    className={inputCls + ' bg-white'}
                  >
                    <option value="">Auto — Foreign Exchange Gain/Loss</option>
                    {glAccounts
                      .filter((g) => g.accountClass === 'income' || g.accountClass === 'expense')
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.accountNumber} · {g.accountName}
                        </option>
                      ))}
                  </select>
                </Field>
              )}

              <Field label="Memo">
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          {/* Receipt / attachment — available on any transaction, any status */}
          <div className="pt-3 border-t border-[#E1E6EB]">
            <div className="text-xs font-medium text-[#576981] mb-2">Receipt / attachment</div>
            <AttachmentList entityType="bank_transaction" entityId={tx.id} />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#E1E6EB] flex items-center justify-between">
          <div className="flex gap-2">
            {!isExcluded && !isPosted && (
              <button
                onClick={exclude}
                disabled={excluding || saving}
                className="text-xs text-[#BF2600] hover:underline"
              >
                {excluding ? 'Excluding…' : 'Exclude'}
              </button>
            )}
            {isPosted && (
              <button
                onClick={unpost}
                disabled={saving}
                className="text-xs text-[#BF2600] hover:underline"
              >
                Move back to Pending
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]"
            >
              Cancel
            </button>
            {(!isPosted && !isExcluded) && mode === 'categorize' && (
              <button
                onClick={categorize}
                disabled={saving}
                className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {saving ? 'Posting…' : 'Categorize'}
              </button>
            )}
            {(!isPosted && !isExcluded) && mode === 'transfer' && (
              <button
                onClick={transfer}
                disabled={saving || !counterpartId}
                className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {saving ? 'Posting…' : 'Record transfer'}
              </button>
            )}
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
