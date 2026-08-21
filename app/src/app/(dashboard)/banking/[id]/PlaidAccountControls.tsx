'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  bankAccountId: string
  lastSyncAt: string | null
  itemStatus: string // active | login_required | error | disconnected
}

export default function PlaidAccountControls({ bankAccountId, lastSyncAt, itemStatus }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'' | 'sync' | 'disconnect'>('')

  async function syncNow() {
    setBusy('sync')
    try {
      const res = await fetch('/api/plaid/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      const n = data.inserted ?? 0
      alert(`Synced. Imported ${n} new transaction${n === 1 ? '' : 's'}.`)
      router.refresh()
    } catch (e) {
      alert(`Sync failed: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setBusy('')
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect this account from Plaid? Imported transactions are kept; no new ones will sync.')) {
      return
    }
    setBusy('disconnect')
    try {
      const res = await fetch('/api/plaid/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId }),
      })
      if (!res.ok) throw new Error('Disconnect failed')
      router.refresh()
    } catch (e) {
      alert(`Could not disconnect: ${e instanceof Error ? e.message : 'error'}`)
      setBusy('')
    }
  }

  const needsReconnect = itemStatus === 'login_required' || itemStatus === 'error'

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[#576981]">
        {needsReconnect ? (
          <span className="text-[#BF2600] font-medium">Plaid needs reconnect</span>
        ) : (
          <>
            Plaid connected
            {lastSyncAt ? ` · synced ${new Date(lastSyncAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}` : ''}
          </>
        )}
      </span>
      <button
        onClick={syncNow}
        disabled={busy !== ''}
        className="text-sm font-medium text-[#0075DD] hover:underline disabled:opacity-50"
      >
        {busy === 'sync' ? 'Syncing…' : 'Sync now'}
      </button>
      <button
        onClick={disconnect}
        disabled={busy !== ''}
        className="text-sm text-[#576981] hover:text-[#BF2600] disabled:opacity-50"
      >
        {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
      </button>
    </div>
  )
}
