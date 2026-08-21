'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface AccountOption {
  id: string
  accountNumber: string
  accountName: string
  currency: string
  bookBalance: number
  reconciledBalance: number
  lastReconciledAt: string | null
}

interface Props {
  accounts: AccountOption[]
}

export default function StartReconciliationForm({ accounts }: Props) {
  const router = useRouter()
  const [accountId, setAccountId] = useState('')
  const [statementEndDate, setStatementEndDate] = useState(new Date().toISOString().slice(0, 10))
  const [statementBalance, setStatementBalance] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const account = accounts.find((a) => a.id === accountId)
  const beginning = account?.reconciledBalance ?? 0

  async function start() {
    setError('')
    if (!accountId) {
      setError('Pick an account.')
      return
    }
    if (!statementBalance) {
      setError('Enter the statement closing balance.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId: accountId,
          statementEndDate,
          beginningBalance: beginning,
          endingBalance: parseFloat(statementBalance),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Failed to start')
      }
      const created = await res.json()
      router.push(`/banking/reconcile/${created.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
      <h2 className="text-base font-semibold text-[#001B40] mb-4">Start a new reconciliation</h2>

      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">
            Which account do you want to reconcile?
          </label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full h-10 px-3 border border-[#E1E6EB] rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            <option value="">— Select an account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} — {a.accountName} ({a.currency})
              </option>
            ))}
          </select>
        </div>

        {account && (
          <div className="p-3 bg-[#F5F7FA] rounded text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[#576981]">Beginning balance (last reconciled)</span>
              <strong className="text-[#001B40]">
                {formatCurrency(beginning, account.currency, { includeCode: false })}
              </strong>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#576981]">Current book balance</span>
              <strong className="text-[#001B40]">
                {formatCurrency(account.bookBalance, account.currency, { includeCode: false })}
              </strong>
            </div>
            {account.lastReconciledAt && (
              <div className="mt-1 text-[10px] text-[#8C9BAB]">
                Last reconciled {new Date(account.lastReconciledAt).toLocaleDateString()}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#576981] mb-1">
              Statement end date
            </label>
            <input
              type="date"
              value={statementEndDate}
              onChange={(e) => setStatementEndDate(e.target.value)}
              className="w-full h-10 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#576981] mb-1">
              Statement closing balance
            </label>
            <input
              type="number"
              step="0.01"
              value={statementBalance}
              onChange={(e) => setStatementBalance(e.target.value)}
              placeholder="0.00"
              className="w-full h-10 px-3 border border-[#E1E6EB] rounded text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
          </div>
        </div>

        <button
          onClick={start}
          disabled={submitting}
          className="w-full px-5 py-2.5 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {submitting ? 'Starting…' : 'Start reconciling'}
        </button>
      </div>
    </div>
  )
}
