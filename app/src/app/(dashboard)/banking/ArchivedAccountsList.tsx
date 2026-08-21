'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ArchivedAccount {
  id: string
  accountNumber: string
  accountName: string
  currency: string
}

export default function ArchivedAccountsList({
  accounts,
}: {
  accounts: ArchivedAccount[]
}) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [show, setShow] = useState(false)

  async function restore(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/bank-accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: false }),
      })
      if (!res.ok) throw new Error('request failed')
      router.refresh()
    } catch {
      alert('Could not restore the account. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (accounts.length === 0) return null

  return (
    <div className="mt-10">
      <button
        onClick={() => setShow((s) => !s)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#576981] hover:text-[#001B40] mb-2"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${show ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9 6l6 6-6 6z" />
        </svg>
        {show ? 'Hide' : 'Show'} archived accounts ({accounts.length})
      </button>
      {show && (
      <div className="bg-white rounded-lg border border-[#E1E6EB] divide-y divide-[#E1E6EB]">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between px-4 py-3">
            <div className="text-sm text-[#001B40]">
              <span className="font-mono text-[#576981]">{a.accountNumber}</span> · {a.accountName}{' '}
              <span className="text-xs text-[#8C9BAB]">({a.currency})</span>
            </div>
            <button
              onClick={() => restore(a.id)}
              disabled={busyId === a.id}
              className="text-sm font-medium text-[#0075DD] hover:underline disabled:opacity-50"
            >
              {busyId === a.id ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        ))}
      </div>
      )}
    </div>
  )
}
