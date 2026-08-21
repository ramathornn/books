'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ACCOUNT_TYPES, getTypeForDetailType } from '@/lib/accountTypes'

type AccountClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

interface Parent {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
}

interface Props {
  mode: 'new' | 'edit'
  parents: Parent[]
  account?: {
    id: string
    accountNumber: string
    accountName: string
    description: string
    accountClass: AccountClass
    accountSubclass: string
    detailType?: string
    gifiCode?: string | null
    cashFlowSection?: string | null
    parentId: string | null
    currency: string
    isReconcilable: boolean
    openingBalance: number
    currentBalance: number
  }
}

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD']

export default function GLAccountForm({ mode, parents, account }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const initialType =
    (account?.detailType ? getTypeForDetailType(account.detailType)?.type : null) ||
    account?.accountSubclass ||
    'Bank'
  const initialDetailType = account?.detailType || ''

  const [accountNumber, setAccountNumber] = useState(account?.accountNumber || '')
  const [accountName, setAccountName] = useState(account?.accountName || '')
  const [description, setDescription] = useState(account?.description || '')
  const [typeLabel, setTypeLabel] = useState(initialType)
  const [detailType, setDetailType] = useState(initialDetailType)
  const [gifiCode, setGifiCode] = useState(account?.gifiCode || '')
  const [cashFlowSection, setCashFlowSection] = useState(account?.cashFlowSection || '')
  const [parentId, setParentId] = useState(account?.parentId || '')
  const [currency, setCurrency] = useState(account?.currency || 'CAD')
  const [isReconcilable, setIsReconcilable] = useState(account?.isReconcilable || false)
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalance || 0)

  const currentType = useMemo(
    () => ACCOUNT_TYPES.find((t) => t.type === typeLabel),
    [typeLabel]
  )
  const detailTypes = currentType?.detailTypes ?? []
  const filteredParents = useMemo(() => {
    if (!currentType) return []
    return parents.filter((p) => p.accountClass === currentType.internalClass)
  }, [parents, currentType])

  function changeType(next: string) {
    const t = ACCOUNT_TYPES.find((x) => x.type === next)
    setTypeLabel(next)
    setDetailType(t?.detailTypes[0]?.value || '')
    setParentId('')
    setIsReconcilable(t?.defaultReconcilable ?? false)
  }

  async function save() {
    setError('')
    if (!accountNumber.trim() || !accountName.trim()) {
      setError('Account number and name are required.')
      return
    }
    if (!currentType) {
      setError('Pick an account type.')
      return
    }
    if (!detailType) {
      setError('Pick a detail type.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        accountNumber,
        accountName,
        description,
        accountClass: currentType.internalClass,
        accountSubclass: typeLabel, // Type label
        detailType,
        gifiCode: gifiCode.trim() || null,
        cashFlowSection: cashFlowSection || null,
        parentId: parentId || null,
        currency,
        isReconcilable,
        openingBalance,
      }
      const url = mode === 'edit' ? `/api/gl-accounts/${account!.id}` : '/api/gl-accounts'
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
      router.push('/accounting/chart-of-accounts')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/accounting/chart-of-accounts" className="text-xs text-[#0075DD] hover:underline">
            Chart of Accounts
          </Link>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {mode === 'edit' ? 'Edit Account' : 'New Account'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/accounting/chart-of-accounts" className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]">
            Cancel
          </Link>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-6 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Account Type" required>
            <select
              value={typeLabel}
              onChange={(e) => changeType(e.target.value)}
              className={inputCls + ' bg-white'}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Detail Type" required>
            <select
              value={detailType}
              onChange={(e) => setDetailType(e.target.value)}
              className={inputCls + ' bg-white'}
            >
              <option value="">— Select —</option>
              {detailTypes.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Account Number" required>
            <input
              type="text"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="e.g. 1000"
              className={inputCls + ' font-mono'}
            />
          </Field>
          <Field label="Currency">
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={inputCls + ' bg-white'}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <Field label="GIFI Code">
            <input
              type="text"
              inputMode="numeric"
              value={gifiCode}
              onChange={(e) => setGifiCode(e.target.value)}
              placeholder="e.g. 1001"
              className={inputCls + ' font-mono'}
            />
            <p className="mt-1 text-[11px] text-[#576981]">
              CRA 4-digit GIFI code for the T2 return. Leave blank if unsure.
            </p>
          </Field>

          <Field label="Cash Flow Section">
            <select
              value={cashFlowSection}
              onChange={(e) => setCashFlowSection(e.target.value)}
              className={inputCls}
            >
              <option value="">Automatic (default)</option>
              <option value="operating">Operating</option>
              <option value="investing">Investing</option>
              <option value="financing">Financing</option>
            </select>
            <p className="mt-1 text-[11px] text-[#576981]">
              Overrides where this account appears on the Cash Flow report. Leave on Automatic unless your accountant says otherwise.
            </p>
          </Field>

          <div className="col-span-2">
            <Field label="Account Name" required>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. Business Chequing (1234)"
                className={inputCls}
              />
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="Parent Account">
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className={inputCls + ' bg-white'}
              >
                <option value="">No parent</option>
                {filteredParents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.accountNumber} — {p.accountName}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[#576981]">
                Parents are filtered to the same account class.
              </p>
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={inputCls + ' h-auto py-2 resize-none'}
              />
            </Field>
          </div>

          <Field label="Opening Balance">
            <input
              type="number"
              step="0.01"
              value={openingBalance || ''}
              onChange={(e) => setOpeningBalance(parseFloat(e.target.value) || 0)}
              disabled={mode === 'edit'}
              className={inputCls + ' font-mono disabled:bg-[#F5F7FA]'}
            />
          </Field>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-[#001B40] mb-2">
              <input
                type="checkbox"
                checked={isReconcilable}
                onChange={(e) => setIsReconcilable(e.target.checked)}
                className="rounded border-[#E1E6EB]"
              />
              Reconcilable (bank/credit card)
            </label>
          </div>

          {mode === 'edit' && (
            <div className="col-span-2 pt-4 border-t border-[#E1E6EB]">
              <div className="text-xs text-[#576981]">Current Balance</div>
              <div className="text-lg font-semibold text-[#001B40]">
                {account?.currentBalance.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                {currency}
              </div>
            </div>
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
