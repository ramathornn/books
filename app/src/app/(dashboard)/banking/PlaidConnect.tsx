'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaidLink } from 'react-plaid-link'
import Modal from '@/components/ui/Modal'

export interface BankAccountOption {
  id: string
  accountNumber: string
  accountName: string
  currency: string
  mask: string
}

interface PlaidAccount {
  accountId: string
  name: string
  officialName: string
  mask: string
  type: string
  subtype: string
  currency: string
}

interface ExchangeResult {
  itemId: string
  institutionName: string
  accounts: PlaidAccount[]
}

const OAUTH_TOKEN_KEY = 'plaid_link_token'
const DEFAULT_SYNC_FROM = '2025-01-01' // books are locked through 2024-12-31

export default function PlaidConnect({
  bankAccounts,
}: {
  bankAccounts: BankAccountOption[]
}) {
  const router = useRouter()
  const [token, setToken] = useState<string>('')
  const [pendingOpen, setPendingOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExchangeResult | null>(null)

  const isOauthReturn =
    typeof window !== 'undefined' && window.location.search.includes('oauth_state_id')

  // Restore the saved link token when the bank's OAuth flow redirects back.
  useEffect(() => {
    if (isOauthReturn && !token) {
      const saved = localStorage.getItem(OAUTH_TOKEN_KEY)
      if (saved) {
        setToken(saved)
        setPendingOpen(true)
      }
    }
  }, [isOauthReturn, token])

  const handleSuccess = useCallback(async (publicToken: string) => {
    localStorage.removeItem(OAUTH_TOKEN_KEY)
    setBusy(true)
    try {
      const res = await fetch('/api/plaid/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicToken }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not connect')
      setResult(data as ExchangeResult)
    } catch (e) {
      alert(`Could not finish connecting: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setBusy(false)
    }
  }, [])

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken) => handleSuccess(publicToken),
    onExit: () => setPendingOpen(false),
    ...(isOauthReturn ? { receivedRedirectUri: window.location.href } : {}),
  })

  useEffect(() => {
    if (pendingOpen && ready && token) {
      setPendingOpen(false)
      open()
    }
  }, [pendingOpen, ready, token, open])

  async function startConnect() {
    setBusy(true)
    try {
      const res = await fetch('/api/plaid/link-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start Plaid')
      localStorage.setItem(OAUTH_TOKEN_KEY, data.linkToken)
      setToken(data.linkToken)
      setPendingOpen(true)
    } catch (e) {
      alert(`Could not start Plaid: ${e instanceof Error ? e.message : 'error'}`)
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={startConnect}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0075DD] rounded hover:bg-[#005FB3] disabled:opacity-50"
      >
        {busy ? 'Connecting…' : 'Connect a bank (Plaid)'}
      </button>

      {result && (
        <MappingModal
          result={result}
          bankAccounts={bankAccounts}
          onClose={() => setResult(null)}
          onDone={() => {
            setResult(null)
            router.refresh()
          }}
        />
      )}
    </>
  )
}

function MappingModal({
  result,
  bankAccounts,
  onClose,
  onDone,
}: {
  result: ExchangeResult
  bankAccounts: BankAccountOption[]
  onClose: () => void
  onDone: () => void
}) {
  // Per Plaid account: which bank account to map to + the sync-from date.
  // Auto-match by mask where possible.
  const [rows, setRows] = useState(() =>
    result.accounts.map((pa) => {
      const match = bankAccounts.find((b) => b.mask && b.mask === pa.mask)
      return {
        plaidAccountId: pa.accountId,
        label: `${pa.name}${pa.mask ? ` ••${pa.mask}` : ''} · ${pa.subtype || pa.type} (${pa.currency})`,
        bankAccountId: match?.id || '',
        syncFrom: DEFAULT_SYNC_FROM,
      }
    })
  )
  const [saving, setSaving] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)

  function update(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  async function connect() {
    const mappings = rows
      .filter((r) => r.bankAccountId)
      .map((r) => ({
        bankAccountId: r.bankAccountId,
        plaidAccountId: r.plaidAccountId,
        syncFrom: r.syncFrom,
      }))
    if (mappings.length === 0) {
      alert('Map at least one account to import.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/plaid/link-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: result.itemId, mappings }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not connect')
      const ins = data.sync?.inserted ?? 0
      setSummary(
        data.syncError
          ? `Connected, but the first sync errored (${data.syncError}). Use “Sync now” to retry.`
          : `Connected. Imported ${ins} transaction${ins === 1 ? '' : 's'} (pending review).`
      )
    } catch (e) {
      alert(`Could not connect: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Connect ${result.institutionName || 'your bank'}`}>
      {summary ? (
        <div className="space-y-4">
          <div className="rounded bg-[#E6F4EA] border border-[#A7D8B5] px-3 py-2 text-sm text-[#216E39]">
            {summary}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onDone}
              className="px-4 py-2 text-sm font-medium text-white bg-[#001B40] rounded hover:bg-[#002D79]"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-[#576981]">
            Map each account from {result.institutionName || 'this bank'} to one of your existing
            accounts and choose how far back to pull transactions.
          </p>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={r.plaidAccountId} className="border border-[#E1E6EB] rounded p-3">
                <div className="text-sm font-medium text-[#001B40] mb-2">{r.label}</div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs text-[#576981] mb-1">Import into</span>
                    <select
                      value={r.bankAccountId}
                      onChange={(e) => update(i, { bankAccountId: e.target.value })}
                      className={inputCls + ' bg-white'}
                    >
                      <option value="">— Don&apos;t import —</option>
                      {bankAccounts.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.accountNumber} · {b.accountName} ({b.currency})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs text-[#576981] mb-1">Sync from</span>
                    <input
                      type="date"
                      value={r.syncFrom}
                      onChange={(e) => update(i, { syncFrom: e.target.value })}
                      className={inputCls}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E1E6EB]">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]">
              Cancel
            </button>
            <button
              onClick={connect}
              disabled={saving}
              className="px-5 py-2 text-sm font-medium text-white bg-[#038A06] rounded hover:bg-[#026e05] disabled:opacity-50"
            >
              {saving ? 'Connecting & syncing…' : 'Connect & sync'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'
