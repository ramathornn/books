'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface BankAccountOption {
  id: string
  name: string
}

interface Row {
  id: string
  bankAccountId: string
  bankAccountName: string
  currency: string
  date: string
  description: string
  payee: string
  category: string
  amount: number
  isReconciled: boolean
}

export default function BankExpensesSection({
  bankAccounts,
}: {
  bankAccounts: BankAccountOption[]
}) {
  const [bankAccountId, setBankAccountId] = useState('')
  const [reconciled, setReconciled] = useState('') // '' | 'true' | 'false'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const sp = new URLSearchParams()
      if (bankAccountId) sp.set('bankAccountId', bankAccountId)
      if (reconciled) sp.set('reconciled', reconciled)
      const res = await fetch(`/api/bank-transactions/expenses?${sp.toString()}`)
      const data = await res.json()
      setRows(data.rows || [])
    } finally {
      setLoading(false)
    }
  }, [bankAccountId, reconciled])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  return (
    <div className="mt-8">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#576981] hover:text-[#001B40] mb-2"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 6l6 6-6 6z" />
        </svg>
        Expenses from bank
      </button>

      {open && (
        <div className="bg-white rounded-lg border border-[#E1E6EB]">
          <div className="flex flex-wrap items-center gap-3 p-3 border-b border-[#E1E6EB]">
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(e.target.value)}
              className="h-9 px-3 border border-[#E1E6EB] rounded text-sm bg-white"
            >
              <option value="">All bank accounts</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <select
              value={reconciled}
              onChange={(e) => setReconciled(e.target.value)}
              className="h-9 px-3 border border-[#E1E6EB] rounded text-sm bg-white"
            >
              <option value="">Processed (all)</option>
              <option value="true">Reconciled</option>
              <option value="false">Not reconciled</option>
            </select>
            <span className="text-xs text-[#8C9BAB] ml-auto">
              {loading ? 'Loading…' : `${rows.length} transaction${rows.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {!loading && rows.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#576981]">
              No categorized bank expenses match these filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-[#F5F7FA]">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Description</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Account</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Category</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-[#576981]">Reconciled</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                      <td className="px-3 py-2 whitespace-nowrap text-[#001B40]">{r.date}</td>
                      <td className="px-3 py-2 text-[#001B40]">
                        <Link href={`/banking/${r.bankAccountId}`} className="text-[#0075DD] hover:underline">
                          {r.payee || r.description || '(no description)'}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-[#576981]">{r.bankAccountName}</td>
                      <td className="px-3 py-2 text-[#576981]">{r.category}</td>
                      <td className="px-3 py-2 text-center">
                        {r.isReconciled ? (
                          <span className="text-[#216E39]">✓</span>
                        ) : (
                          <span className="text-[#8C9BAB]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[#001B40]">
                        {formatCurrency(r.amount, r.currency, { includeCode: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
