'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface Props {
  accountId: string
  accountName: string
  balance: number
  currency: string
  isArchived: boolean
}

export default function ArchiveAccountButton({
  accountId,
  accountName,
  balance,
  currency,
  isArchived,
}: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function setArchived(archived: boolean) {
    if (archived) {
      const hasBalance = Math.abs(balance) >= 0.005
      const msg = hasBalance
        ? `${accountName} still has a balance of ${formatCurrency(balance, currency)}. ` +
          `Archiving hides it from Banking, but it will stay in your Chart of Accounts until ` +
          `the balance is zero (record the closing transfer first). Archive anyway?`
        : `Archive ${accountName}? It will be hidden from Banking and your Chart of Accounts. ` +
          `All transaction history is kept, and you can restore it anytime from the Banking page.`
      if (!confirm(msg)) return
    }
    setBusy(true)
    try {
      const res = await fetch(`/api/bank-accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isArchived: archived }),
      })
      if (!res.ok) throw new Error('request failed')
      if (archived) {
        router.push('/banking')
      } else {
        router.refresh()
      }
    } catch {
      setBusy(false)
      alert(`Could not ${archived ? 'archive' : 'restore'} the account. Please try again.`)
    }
  }

  if (isArchived) {
    return (
      <button
        onClick={() => setArchived(false)}
        disabled={busy}
        className="text-sm font-medium text-[#0075DD] hover:underline disabled:opacity-50"
      >
        {busy ? 'Restoring…' : 'Restore account'}
      </button>
    )
  }

  return (
    <button
      onClick={() => setArchived(true)}
      disabled={busy}
      className="text-sm text-[#576981] hover:text-[#BF2600] disabled:opacity-50"
    >
      {busy ? 'Archiving…' : 'Archive account'}
    </button>
  )
}
