'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface AccountOpt {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
}
interface TaxCodeOpt {
  id: string
  code: string
  name: string
}
interface Connection {
  id: string
  displayName: string
  accountId: string
  status: string
  lastSyncAt: string | null
  lastError: string | null
}

// Field metadata: [state key, label, helper, filter by account class]
const ACCOUNT_FIELDS: Array<[string, string, string, string | null]> = [
  ['revenueAccountId', 'Revenue account', 'Sales revenue credited per charge (gross).', 'income'],
  ['feeAccountId', 'Processing-fee account', 'Stripe fees, expensed.', 'expense'],
  ['clearingAccountId', 'Stripe clearing account', 'Holds the Stripe balance until payout.', 'asset'],
  ['gstPayableAccountId', 'GST/HST payable', 'GST carved out of domestic sales.', 'liability'],
  ['payoutDestinationAccountId', 'Payout destination', 'Account a Stripe payout lands in.', 'asset'],
]

export default function StripeSourceSettings({
  glAccounts,
  taxCodes,
  connection,
}: {
  glAccounts: AccountOpt[]
  taxCodes: TaxCodeOpt[]
  connection: Connection | null
}) {
  const router = useRouter()
  const [secretKey, setSecretKey] = useState('')
  const [displayName, setDisplayName] = useState('Stripe')
  const [map, setMap] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  function optsFor(cls: string | null) {
    const list = cls ? glAccounts.filter((a) => a.accountClass === cls) : glAccounts
    return list.length ? list : glAccounts
  }

  async function connect() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/api/stripe-source/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secretKey, displayName, ...map }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to connect')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect')
    } finally {
      setBusy(false)
    }
  }

  async function sync() {
    if (!connection) return
    setError(null)
    setSyncMsg(null)
    setBusy(true)
    try {
      const res = await fetch('/api/stripe-source/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      const r = data.result
      setSyncMsg(`Scanned ${r.scanned} · posted ${r.created} · skipped ${r.skipped} · unhandled ${r.unhandled}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    if (!connection) return
    setBusy(true)
    try {
      await fetch('/api/stripe-source/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connection.id }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-sm shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-1">Stripe revenue sync</h2>
      <p className="text-sm text-gray-500 mb-4">
        Connect a Stripe account with a <span className="font-medium">restricted, read-only</span> key to
        import per-charge revenue (fees and GST place-of-supply handled automatically) as draft journal
        entries.
      </p>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {connection ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900">
                {connection.displayName}
                {connection.accountId ? <span className="text-gray-400"> · {connection.accountId}</span> : null}
              </div>
              <div className="text-xs text-gray-500">
                Status: {connection.status}
                {connection.lastSyncAt ? ` · last sync ${new Date(connection.lastSyncAt).toLocaleString()}` : ' · never synced'}
              </div>
              {connection.lastError && <div className="text-xs text-red-600 mt-1">{connection.lastError}</div>}
            </div>
            <div className="flex gap-2">
              <button
                onClick={sync}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Sync now'}
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
          {syncMsg && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{syncMsg}</div>}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Restricted API key</label>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder="rk_live_…"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-900"
            />
            <p className="mt-1 text-xs text-gray-400">
              Create a restricted key in Stripe with read access to Balance transactions and Charges. Stored
              encrypted at rest.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-900"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {ACCOUNT_FIELDS.map(([key, label, helper, cls]) => (
              <div key={key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
                <select
                  value={map[key] || ''}
                  onChange={(e) => setMap((m) => ({ ...m, [key]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-900"
                >
                  <option value="">Select…</option>
                  {optsFor(cls).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.accountNumber} — {a.accountName}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-400">{helper}</p>
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">GST-on-income tax code</label>
              <select
                value={map.gstTaxCodeId || ''}
                onChange={(e) => setMap((m) => ({ ...m, gstTaxCodeId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-900"
              >
                <option value="">Select…</option>
                {taxCodes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zero-rated tax code</label>
              <select
                value={map.zeroRatedTaxCodeId || ''}
                onChange={(e) => setMap((m) => ({ ...m, zeroRatedTaxCodeId: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-900"
              >
                <option value="">Select…</option>
                {taxCodes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={connect}
            disabled={busy || !secretKey}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Connecting…' : 'Connect Stripe'}
          </button>
        </div>
      )}
    </div>
  )
}
