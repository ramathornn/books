'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface AccountOption {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
  currency: string
}

interface BalanceLine {
  accountId: string
  accountNumber: string
  accountName: string
  accountClass: string
  balance: number // signed: positive = debit-normal balance, negative = credit-normal balance
}

interface Props {
  accounts: AccountOption[]
  defaultContraAccountId: string
}

function parseAmount(s: string): number {
  if (!s) return 0
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ''))
  return isNaN(n) ? 0 : n
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length === 0) return { headers: [], rows: [] }
  function splitRow(s: string): string[] {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (c === '"') {
        if (inQ && s[i + 1] === '"') { cur += '"'; i++ } else { inQ = !inQ }
      } else if (c === ',' && !inQ) {
        out.push(cur); cur = ''
      } else {
        cur += c
      }
    }
    out.push(cur)
    return out.map((x) => x.trim())
  }
  const headers = splitRow(lines[0])
  const rows = lines.slice(1).map(splitRow)
  return { headers, rows }
}

export default function OpeningBalanceWizard({ accounts, defaultContraAccountId }: Props) {
  const router = useRouter()
  const [step, setStep] = useState<'config' | 'review' | 'done'>('config')
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [contraAccountId, setContraAccountId] = useState(defaultContraAccountId)
  const [memo, setMemo] = useState('Opening balance migration from previous accounting system')
  const [lines, setLines] = useState<BalanceLine[]>([])
  const [error, setError] = useState('')
  const [posting, setPosting] = useState(false)

  function isDebitNormal(cls: string) {
    return cls === 'asset' || cls === 'expense'
  }

  function addBlankLine() {
    setLines((prev) => [
      ...prev,
      { accountId: '', accountNumber: '', accountName: '', accountClass: '', balance: 0 },
    ])
  }

  function setLine(i: number, accountId: string) {
    const a = accounts.find((x) => x.id === accountId)
    setLines((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? a
            ? {
                accountId: a.id,
                accountNumber: a.accountNumber,
                accountName: a.accountName,
                accountClass: a.accountClass,
                balance: l.balance,
              }
            : { accountId: '', accountNumber: '', accountName: '', accountClass: '', balance: 0 }
          : l
      )
    )
  }

  function setBalance(i: number, balance: number) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, balance } : l)))
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  /**
   * CSV format: account_number, account_name (optional), balance
   * Balance is the natural-side balance (asset/expense as positive debit;
   * liability/equity/income as positive credit). Sign convention matches a standard trial-balance export.
   */
  async function importTrialBalance(file: File) {
    setError('')
    const text = await file.text()
    const { headers, rows } = parseCSV(text)
    if (headers.length === 0) {
      setError('Could not parse CSV.')
      return
    }
    // Find columns
    const lcHeaders = headers.map((h) => h.toLowerCase())
    const numIdx = lcHeaders.findIndex((h) => h.includes('account') && (h.includes('number') || h.includes('#')))
    const nameIdx = lcHeaders.findIndex((h) => h === 'name' || h.includes('account name') || h === 'account')
    const balIdx = lcHeaders.findIndex((h) => h.includes('balance') || h.includes('amount'))
    const debitIdx = lcHeaders.findIndex((h) => h === 'debit')
    const creditIdx = lcHeaders.findIndex((h) => h === 'credit')

    const newLines: BalanceLine[] = []
    let unmatched = 0
    for (const r of rows) {
      const num = numIdx >= 0 ? r[numIdx]?.trim() : ''
      const name = nameIdx >= 0 ? r[nameIdx]?.trim() : ''
      let balance = 0
      if (debitIdx >= 0 && creditIdx >= 0) {
        balance = parseAmount(r[debitIdx]) - parseAmount(r[creditIdx])
      } else if (balIdx >= 0) {
        balance = parseAmount(r[balIdx])
      }
      // Match account
      const a =
        (num && accounts.find((x) => x.accountNumber === num)) ||
        (name && accounts.find((x) => x.accountName.toLowerCase() === name.toLowerCase()))
      if (!a) {
        if (Math.abs(balance) > 0.005) unmatched += 1
        continue
      }
      // Trial-balance convention: balances are positive on natural side. We store as signed-debit-normal.
      // For asset/expense → balance as-is. For liability/equity/income → flip sign so we keep "debit-normal" sign internally.
      const signed = isDebitNormal(a.accountClass) ? balance : -balance
      if (Math.abs(signed) < 0.005) continue
      newLines.push({
        accountId: a.id,
        accountNumber: a.accountNumber,
        accountName: a.accountName,
        accountClass: a.accountClass,
        balance: signed,
      })
    }
    if (newLines.length === 0) {
      setError(
        unmatched
          ? `${unmatched} rows didn't match any account. Make sure your CSV has 'Account Number' and 'Balance' columns.`
          : 'No usable rows.'
      )
      return
    }
    setLines(newLines)
    if (unmatched) {
      setError(`Imported ${newLines.length} lines. ${unmatched} rows didn't match any account and were skipped.`)
    }
  }

  // Compute net balance — should be zero for a valid TB
  const netDebit = lines.reduce((s, l) => s + (l.balance > 0 ? l.balance : 0), 0)
  const netCredit = lines.reduce((s, l) => s + (l.balance < 0 ? -l.balance : 0), 0)
  const imbalance = Math.round((netDebit - netCredit) * 100) / 100

  const contraAccount = accounts.find((a) => a.id === contraAccountId)

  async function postEntry() {
    setError('')
    if (!contraAccountId) {
      setError('Pick a contra account (typically Opening Balance Equity).')
      return
    }
    const validLines = lines.filter((l) => l.accountId && Math.abs(l.balance) > 0.005)
    if (validLines.length === 0) {
      setError('Add at least one balance line.')
      return
    }

    // Build JE lines: each TB line becomes a debit (if signed positive) or credit (if negative).
    // Then add contra entry to balance to zero.
    const jeLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = []
    for (const l of validLines) {
      if (l.balance > 0) {
        jeLines.push({
          glAccountId: l.accountId,
          description: `Opening balance ${l.accountNumber}`,
          debit: l.balance,
          credit: 0,
        })
      } else {
        jeLines.push({
          glAccountId: l.accountId,
          description: `Opening balance ${l.accountNumber}`,
          debit: 0,
          credit: -l.balance,
        })
      }
    }
    // Contra
    if (Math.abs(imbalance) > 0.005) {
      if (imbalance > 0) {
        jeLines.push({
          glAccountId: contraAccountId,
          description: `Opening balance contra`,
          debit: 0,
          credit: imbalance,
        })
      } else {
        jeLines.push({
          glAccountId: contraAccountId,
          description: `Opening balance contra`,
          debit: -imbalance,
          credit: 0,
        })
      }
    }

    setPosting(true)
    try {
      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryDate,
          description: 'Opening balance migration',
          memo,
          status: 'posted',
          lines: jeLines.map((l) => ({
            ...l,
            taxCodes: [],
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || d.details ? JSON.stringify(d.details) : 'Post failed')
      }
      // After posting, lock the period through entryDate
      await fetch('/api/accounting-period', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedThrough: entryDate, notes: 'Locked after opening balance migration.' }),
      })
      setStep('done')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed')
    } finally {
      setPosting(false)
    }
  }

  if (step === 'done') {
    return (
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-8 text-center">
        <div className="text-3xl mb-2">✓</div>
        <h2 className="text-lg font-semibold text-[#001B40] mb-1">Opening balance posted.</h2>
        <p className="text-sm text-[#576981] mb-4">
          Books locked through {entryDate}. You can now bookkeep transactions dated after that.
        </p>
        <Link
          href="/accounting/journal-entries"
          className="inline-block px-4 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded"
        >
          View journal entries
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h3 className="text-base font-semibold text-[#001B40] mb-4">1. Setup</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Entry date">
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Contra account (Opening Balance Equity)">
            <select
              value={contraAccountId}
              onChange={(e) => setContraAccountId(e.target.value)}
              className={inputCls + ' bg-white'}
            >
              <option value="">— Select —</option>
              {accounts
                .filter((a) => a.accountClass === 'equity')
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.accountNumber} · {a.accountName}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Memo">
          <input
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className={inputCls}
          />
        </Field>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[#001B40]">2. Account balances</h3>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer px-3 py-1.5 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]">
              Import Trial Balance CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) importTrialBalance(f)
                }}
              />
            </label>
            <button
              onClick={addBlankLine}
              className="px-3 py-1.5 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              + Add line
            </button>
          </div>
        </div>

        <p className="text-xs text-[#576981] mb-3">
          Export the Trial Balance from your previous system at your cutover date as CSV (or paste lines manually). Each line shows the account&apos;s
          natural-side balance. We&apos;ll auto-add a contra entry to balance debits and credits.
        </p>

        {lines.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#576981] border border-dashed border-[#E1E6EB] rounded">
            No lines yet. Import a CSV or click &ldquo;+ Add line&rdquo;.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E1E6EB]">
                  <th className="text-left py-2 px-2 text-xs font-semibold text-[#576981]">Account</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-[#576981]">Debit</th>
                  <th className="text-right py-2 px-2 text-xs font-semibold text-[#576981]">Credit</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-[#E1E6EB]">
                    <td className="py-1.5 px-2">
                      <select
                        value={l.accountId}
                        onChange={(e) => setLine(i, e.target.value)}
                        className="w-full h-8 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                      >
                        <option value="">— Select —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.accountNumber} · {a.accountName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={l.balance > 0 ? l.balance.toFixed(2) : ''}
                        onChange={(e) => setBalance(i, parseFloat(e.target.value || '0'))}
                        className="w-full h-8 px-2 text-sm font-mono text-right border border-[#E1E6EB] rounded"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-1.5 px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={l.balance < 0 ? (-l.balance).toFixed(2) : ''}
                        onChange={(e) => setBalance(i, -parseFloat(e.target.value || '0'))}
                        className="w-full h-8 px-2 text-sm font-mono text-right border border-[#E1E6EB] rounded"
                        placeholder="0.00"
                      />
                    </td>
                    <td className="py-1.5 px-1">
                      <button onClick={() => removeLine(i)} className="text-[#576981] hover:text-[#BF2600] text-sm">
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="text-right py-2 px-2 text-xs font-semibold text-[#576981]">Subtotal:</td>
                  <td className="py-2 px-2 text-sm text-right font-mono font-semibold text-[#001B40]">
                    {formatCurrency(netDebit, 'CAD', { includeCode: false })}
                  </td>
                  <td className="py-2 px-2 text-sm text-right font-mono font-semibold text-[#001B40]">
                    {formatCurrency(netCredit, 'CAD', { includeCode: false })}
                  </td>
                  <td />
                </tr>
                <tr>
                  <td className="text-right py-1 px-2 text-xs font-semibold text-[#576981]">Imbalance (→ contra):</td>
                  <td colSpan={2} className="py-1 px-2 text-sm text-right font-mono font-semibold">
                    {formatCurrency(imbalance, 'CAD', { includeCode: false })}{' '}
                    <span className="text-xs text-[#576981]">
                      → {contraAccount?.accountName || 'contra account'}
                    </span>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5 flex items-center justify-between">
        <div className="text-xs text-[#576981]">
          {lines.length > 0 && (
            <>
              {lines.length} line{lines.length === 1 ? '' : 's'} · contra balances{' '}
              <strong>{formatCurrency(Math.abs(imbalance), 'CAD', { includeCode: false })}</strong> through{' '}
              {contraAccount ? `${contraAccount.accountNumber} ${contraAccount.accountName}` : '— pick an equity account —'}.
            </>
          )}
        </div>
        <button
          onClick={postEntry}
          disabled={posting || lines.length === 0 || !contraAccountId}
          className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {posting ? 'Posting…' : 'Post opening balance JE & lock period'}
        </button>
      </div>
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#576981] mb-1">{label}</span>
      {children}
    </label>
  )
}
