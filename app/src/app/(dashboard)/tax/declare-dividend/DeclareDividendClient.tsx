'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface CreditAccount {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
}

const fmtMoney = (n: number) =>
  n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })

/**
 * Declare-dividend form. Posts to /api/tax/t5/declare-dividend, which books
 * DR Dividends Declared / CR <credit account>. Period-lock and validation are
 * enforced server-side; this surfaces the error (incl. PERIOD_LOCKED).
 *
 * Eligibility DEFAULTS to non-eligible (BLOCKER 3) — the safe choice for an
 * SBD-income CCPC whose GRIP is $0. The form shows live GRIP room and BLOCKS
 * designating an eligible dividend that exceeds it, warning about the ITA 185.1
 * Part III.1 penalty. The server re-checks this; the client gate is a guard rail.
 */
export default function DeclareDividendClient({
  dividendsDeclaredLabel,
  creditAccounts,
  gripRoomRemaining,
}: {
  dividendsDeclaredLabel: string
  creditAccounts: CreditAccount[]
  /** live GRIP room — the ceiling for an eligible designation. */
  gripRoomRemaining: number
}) {
  const router = useRouter()
  const today = new Date().toISOString().slice(0, 10)

  const [amount, setAmount] = useState('')
  const [creditAccountId, setCreditAccountId] = useState('')
  const [declaredDate, setDeclaredDate] = useState(today)
  const [recipientLabel, setRecipientLabel] = useState('')
  // Default to non-eligible (BLOCKER 3).
  const [eligibility, setEligibility] = useState<'eligible' | 'nonEligible'>('nonEligible')
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const input =
    'w-full rounded-md border border-[#D9E1EC] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30'

  const amountNum = Number(amount)
  // GRIP over-designation: an eligible dividend exceeding the available pool.
  const gripExceeded = eligibility === 'eligible' && amountNum > 0 && amountNum > gripRoomRemaining

  async function submit() {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      const res = await fetch('/api/tax/t5/declare-dividend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(amount),
          creditAccountId,
          declaredDate,
          recipientLabel,
          eligibility,
          memo,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to declare dividend')
        return
      }
      setOk(`Dividend of ${Number(amount).toFixed(2)} declared. Journal entry posted.`)
      setAmount('')
      setRecipientLabel('')
      setEligibility('nonEligible')
      setMemo('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const valid =
    Number(amount) > 0 && !!creditAccountId && !!recipientLabel.trim() && !!declaredDate && !gripExceeded

  return (
    <div className="rounded-lg border border-[#E5EAF1] bg-white p-5 space-y-4">
      <div className="text-sm text-[#576981]">
        Debit account: <span className="font-medium text-[#001B40]">{dividendsDeclaredLabel}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">Amount (CAD)</label>
          <input
            className={input}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">Declared date</label>
          <input className={input} type="date" value={declaredDate} onChange={(e) => setDeclaredDate(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Recipient / shareholder label</label>
        <input
          className={input}
          value={recipientLabel}
          onChange={(e) => setRecipientLabel(e.target.value)}
          placeholder="e.g. Jane Doe"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Dividend eligibility</label>
        <div className="flex gap-2">
          {([
            ['eligible', 'Eligible'],
            ['nonEligible', 'Non-eligible'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setEligibility(value)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                eligibility === value
                  ? 'border-[#0075DD] bg-[#EAF3FE] text-[#0063BD]'
                  : 'border-[#D9E1EC] text-[#576981] hover:border-[#B9C6D8]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-[#8595A8]">
          Eligible dividends flow to T5 boxes 24/25/26; non-eligible to boxes 10/11/12. CCPC dividends paid from
          income taxed at the small-business rate are typically non-eligible (the default).
        </p>

        {eligibility === 'eligible' ? (
          <div className="mt-2 rounded-md border border-[#D9E1EC] bg-[#F7FAFD] px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#576981]">Available GRIP room</span>
              <span className="font-medium text-[#001B40] tabular-nums">{fmtMoney(gripRoomRemaining)}</span>
            </div>
            {gripExceeded ? (
              <p className="mt-1.5 text-[#9B2C2C]">
                This eligible dividend of {fmtMoney(amountNum)} exceeds the available General Rate Income Pool.
                Designating more than your GRIP is an excessive eligible dividend designation and triggers the
                ITA 185.1 Part III.1 penalty tax (20%, or 30% if deemed deliberate). Reduce the amount or declare it
                non-eligible.
              </p>
            ) : (
              <p className="mt-1.5 text-[#8595A8]">
                You can only designate a dividend eligible to the extent of your GRIP. The amount entered will be
                checked against this room.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Credit account</label>
        <select className={input} value={creditAccountId} onChange={(e) => setCreditAccountId(e.target.value)}>
          <option value="">Select Dividends Payable or a bank account…</option>
          {creditAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.accountNumber} {a.accountName} ({a.accountClass})
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[#8595A8]">
          Use Dividends Payable to declare now and pay later, or a bank account to record an immediate payment.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Memo (optional)</label>
        <input className={input} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </div>

      {error ? (
        <div className="rounded border border-[#F3C2C2] bg-[#FFF1F1] px-3 py-2 text-sm text-[#9B2C2C]">{error}</div>
      ) : null}
      {ok ? (
        <div className="rounded border border-[#A8D5B5] bg-[#F0FBF3] px-3 py-2 text-sm text-[#256A3A]">{ok}</div>
      ) : null}

      <button
        onClick={submit}
        disabled={busy || !valid}
        className="px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD] disabled:opacity-50"
      >
        {busy ? 'Posting…' : 'Declare dividend'}
      </button>
    </div>
  )
}
