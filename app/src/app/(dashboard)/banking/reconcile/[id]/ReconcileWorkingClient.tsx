'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface Tx {
  id: string
  transactionDate: string
  description: string
  payee: string
  amount: number
  reconciliationSessionId: string | null
}

interface ReconLock {
  id: string
  periodStart: string
  periodEnd: string
}

interface Props {
  session: {
    id: string
    bankAccountId: string
    statementStartDate: string
    statementEndDate: string
    beginningBalance: number
    endingBalance: number
    status: string
  }
  lock: ReconLock | null
  account: {
    id: string
    accountNumber: string
    accountName: string
    currency: string
    bookBalance: number
  }
  transactions: Tx[]
}

export default function ReconcileWorkingClient({ session, lock: initialLock, account, transactions: initialTxs }: Props) {
  const router = useRouter()
  const [txs, setTxs] = useState<Tx[]>(initialTxs)
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')
  const [lock, setLock] = useState<ReconLock | null>(initialLock)
  const [lockBusy, setLockBusy] = useState(false)

  const isCompleted = session.status === 'completed'

  async function lockMonth() {
    setError('')
    setLockBusy(true)
    try {
      const res = await fetch('/api/reconciliation-locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankAccountId: session.bankAccountId,
          periodStart: session.statementStartDate.slice(0, 10),
          periodEnd: session.statementEndDate.slice(0, 10),
        }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Lock failed')
      setLock(d.lock ? { id: d.lock.id, periodStart: d.lock.periodStart, periodEnd: d.lock.periodEnd } : null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to lock')
    } finally {
      setLockBusy(false)
    }
  }

  async function unlockMonth() {
    if (!lock) return
    if (!confirm('Release this reconciliation lock? Transactions in this month will become editable again.')) return
    setError('')
    setLockBusy(true)
    try {
      const res = await fetch(`/api/reconciliation-locks/${lock.id}`, { method: 'DELETE' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Unlock failed')
      setLock(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unlock')
    } finally {
      setLockBusy(false)
    }
  }

  // Derived totals (live from local state for snappy UX)
  const totals = useMemo(() => {
    const cleared = txs.filter((t) => t.reconciliationSessionId === session.id)
    const clearedNet = cleared.reduce((s, t) => s + t.amount, 0)
    const computedEnding = session.beginningBalance + clearedNet
    const difference = session.endingBalance - computedEnding
    const clearedDeposits = cleared.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0)
    const clearedPayments = cleared.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0)
    return {
      cleared,
      clearedCount: cleared.length,
      clearedNet,
      clearedDeposits,
      clearedPayments,
      computedEnding,
      difference,
      isBalanced: Math.abs(difference) < 0.005,
    }
  }, [txs, session.beginningBalance, session.endingBalance, session.id])

  // Persist toggles in batches (debounced)
  const [pendingToggles, setPendingToggles] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (Object.keys(pendingToggles).length === 0) return
    const handle = setTimeout(async () => {
      const cleared = Object.entries(pendingToggles).filter(([, v]) => v).map(([id]) => id)
      const uncleared = Object.entries(pendingToggles).filter(([, v]) => !v).map(([id]) => id)
      try {
        await fetch(`/api/reconciliations/${session.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleared, uncleared }),
        })
      } finally {
        setPendingToggles({})
      }
    }, 400)
    return () => clearTimeout(handle)
  }, [pendingToggles, session.id])

  function toggle(t: Tx) {
    if (isCompleted) return
    const willBeCleared = t.reconciliationSessionId !== session.id
    setTxs((prev) =>
      prev.map((x) =>
        x.id === t.id ? { ...x, reconciliationSessionId: willBeCleared ? session.id : null } : x
      )
    )
    setPendingToggles((p) => ({ ...p, [t.id]: willBeCleared }))
  }

  function clearAll(checked: boolean) {
    if (isCompleted) return
    const updates: Record<string, boolean> = {}
    setTxs((prev) =>
      prev.map((t) => {
        const desired = checked
        if ((t.reconciliationSessionId === session.id) !== desired) updates[t.id] = desired
        return { ...t, reconciliationSessionId: desired ? session.id : null }
      })
    )
    setPendingToggles((p) => ({ ...p, ...updates }))
  }

  async function finish() {
    setError('')
    setFinishing(true)
    try {
      // Flush any pending toggles first
      const cleared = Object.entries(pendingToggles).filter(([, v]) => v).map(([id]) => id)
      const uncleared = Object.entries(pendingToggles).filter(([, v]) => !v).map(([id]) => id)
      if (cleared.length || uncleared.length) {
        await fetch(`/api/reconciliations/${session.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cleared, uncleared }),
        })
        setPendingToggles({})
      }
      const res = await fetch(`/api/reconciliations/${session.id}/finish`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Finish failed')
      }
      router.push('/banking/reconcile')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setFinishing(false)
    }
  }

  async function abandon() {
    if (!confirm('Abandon this reconciliation? Cleared lines will be unmarked and the session closed.')) return
    setSaving(true)
    try {
      await fetch(`/api/reconciliations/${session.id}`, { method: 'DELETE' })
      router.push('/banking/reconcile')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  const filteredTxs = search.trim()
    ? txs.filter((t) =>
        t.description.toLowerCase().includes(search.toLowerCase()) ||
        t.payee.toLowerCase().includes(search.toLowerCase())
      )
    : txs

  const deposits = filteredTxs.filter((t) => t.amount > 0)
  const payments = filteredTxs.filter((t) => t.amount < 0)

  return (
    <div>
      <div className="flex items-center gap-3 mb-2 text-sm">
        <Link href="/banking/reconcile" className="text-[#0075DD] hover:underline">
          ← Reconcile
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h1
            className="text-[24px] sm:text-[32px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {account.accountNumber} {account.accountName}
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            Statement period {session.statementStartDate.slice(0, 10)} → {session.statementEndDate.slice(0, 10)}
            {isCompleted && (
              <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-[#E6F4EA] text-[#216E39]">
                Completed
              </span>
            )}
            {lock && (
              <span className="ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase rounded bg-[#FFF0B3] text-[#7A5C00]">
                Locked
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!isCompleted && (
            <button
              onClick={abandon}
              disabled={saving || finishing}
              className="px-4 py-2 text-sm text-[#BF2600] hover:underline"
            >
              Abandon
            </button>
          )}
          {lock ? (
            <button
              onClick={unlockMonth}
              disabled={lockBusy}
              className="px-4 py-2 text-sm text-[#576981] border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] disabled:opacity-50"
              title={`Locked ${lock.periodStart.slice(0, 10)} → ${lock.periodEnd.slice(0, 10)}`}
            >
              {lockBusy ? 'Releasing…' : 'Unlock month'}
            </button>
          ) : (
            <button
              onClick={lockMonth}
              disabled={lockBusy}
              className="px-4 py-2 text-sm text-[#001B40] border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] disabled:opacity-50"
              title="Freeze this account's transactions for the statement period so they can't be re-categorized, matched, transferred, unposted or deleted."
            >
              {lockBusy ? 'Locking…' : 'Lock month'}
            </button>
          )}
          {!isCompleted && (
            <button
              onClick={finish}
              disabled={!totals.isBalanced || finishing}
              className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {finishing ? 'Finishing…' : 'Finish now'}
            </button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-center">
          <Stat label="Beginning" value={formatCurrency(session.beginningBalance, account.currency, { includeCode: false })} />
          <Stat label="Cleared deposits" value={formatCurrency(totals.clearedDeposits, account.currency, { includeCode: false })} accent="#216E39" />
          <Stat label="Cleared payments" value={formatCurrency(totals.clearedPayments, account.currency, { includeCode: false })} accent="#BF2600" />
          <Stat label="Statement balance" value={formatCurrency(session.endingBalance, account.currency, { includeCode: false })} />
          <Stat
            label="Difference"
            value={formatCurrency(totals.difference, account.currency, { includeCode: false })}
            accent={totals.isBalanced ? '#216E39' : '#BF2600'}
            big
          />
        </div>
        {!totals.isBalanced && !isCompleted && (
          <p className="text-xs text-[#BF2600] text-center mt-2">
            Difference must be 0.00 to finish. Tick or untick lines until it lands.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="flex items-center justify-between p-3 border-b border-[#E1E6EB]">
          <div className="text-xs text-[#576981]">
            {totals.clearedCount} of {txs.length} cleared
          </div>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
              className="w-48 h-8 px-3 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
            {!isCompleted && (
              <>
                <button
                  onClick={() => clearAll(true)}
                  className="px-2 py-1 text-xs text-[#0075DD] hover:underline"
                >
                  Tick all
                </button>
                <button
                  onClick={() => clearAll(false)}
                  className="px-2 py-1 text-xs text-[#576981] hover:underline"
                >
                  Untick all
                </button>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#E1E6EB]">
          <ReconcileColumn
            title={`Payments (${payments.length})`}
            txs={payments}
            sessionId={session.id}
            onToggle={toggle}
            currency={account.currency}
            disabled={isCompleted}
          />
          <ReconcileColumn
            title={`Deposits (${deposits.length})`}
            txs={deposits}
            sessionId={session.id}
            onToggle={toggle}
            currency={account.currency}
            disabled={isCompleted}
          />
        </div>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  big,
}: {
  label: string
  value: string
  accent?: string
  big?: boolean
}) {
  return (
    <div>
      <div className="text-[10px] text-[#576981] uppercase">{label}</div>
      <div
        className={big ? 'text-xl font-semibold' : 'text-base font-semibold'}
        style={{ color: accent || '#001B40' }}
      >
        {value}
      </div>
    </div>
  )
}

function ReconcileColumn({
  title,
  txs,
  sessionId,
  onToggle,
  currency,
  disabled,
}: {
  title: string
  txs: Tx[]
  sessionId: string
  onToggle: (t: Tx) => void
  currency: string
  disabled?: boolean
}) {
  return (
    <div>
      <div className="px-3 py-2 bg-[#F5F7FA] border-b border-[#E1E6EB]">
        <h3 className="text-xs font-semibold text-[#576981] uppercase">{title}</h3>
      </div>
      {txs.length === 0 ? (
        <div className="p-6 text-center text-xs text-[#576981]">None.</div>
      ) : (
        <ul>
          {txs.map((t) => {
            const checked = t.reconciliationSessionId === sessionId
            return (
              <li
                key={t.id}
                onClick={() => !disabled && onToggle(t)}
                className={`flex items-center gap-2 px-3 py-2 border-b border-[#E1E6EB] last:border-b-0 cursor-pointer hover:bg-[#F5F7FA]/60 ${
                  checked ? 'bg-[#F0F8FE]' : ''
                } ${disabled ? 'cursor-default' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  disabled={disabled}
                  className="rounded border-[#E1E6EB] flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[#576981]">{t.transactionDate.slice(0, 10)}</div>
                  <div className="text-sm text-[#001B40] truncate">{t.description}</div>
                </div>
                <div
                  className={`text-sm font-mono font-semibold flex-shrink-0 ${
                    t.amount < 0 ? 'text-[#BF2600]' : 'text-[#216E39]'
                  }`}
                >
                  {formatCurrency(Math.abs(t.amount), currency, { includeCode: false })}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
