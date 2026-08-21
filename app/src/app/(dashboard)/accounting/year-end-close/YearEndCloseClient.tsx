'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface CloseRow {
  accountId: string
  accountNumber: string
  accountName: string
  accountClass: 'income' | 'expense'
  balance: number
  debit: number
  credit: number
}

interface Preview {
  fiscalYear: number
  periodStart: string
  periodEnd: string
  totalIncome: number
  totalExpense: number
  netIncome: number
  rows: CloseRow[]
  retainedEarnings: { id: string; accountNumber: string; accountName: string } | null
  closingLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }>
  alreadyClosed: { closedAt: string; journalEntryId: string | null; netIncome: number } | null
  warnings: string[]
}

export default function YearEndCloseClient() {
  const router = useRouter()
  const [fiscalYear, setFiscalYear] = useState<string>(String(new Date().getFullYear() - 1))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string>('')

  async function loadPreview() {
    setError('')
    setDone('')
    setLoading(true)
    setPreview(null)
    try {
      const res = await fetch(`/api/fiscal-year-close?fiscalYear=${encodeURIComponent(fiscalYear)}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Preview failed')
      }
      setPreview(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  async function commit() {
    if (!preview) return
    if (preview.alreadyClosed) return
    if (!preview.retainedEarnings) {
      setError('No Retained Earnings account resolved — cannot commit.')
      return
    }
    const msg =
      `Post the year-end closing entries for FY${preview.fiscalYear}?\n\n` +
      `Net income: ${formatCurrency(preview.netIncome, 'CAD', { includeCode: false })}\n` +
      `This zeros ${preview.rows.length} income/expense account(s) into ${preview.retainedEarnings.accountName} ` +
      `and LOCKS the books through ${preview.periodEnd}. This cannot be edited once locked.`
    if (!confirm(msg)) return
    setCommitting(true)
    setError('')
    try {
      const res = await fetch('/api/fiscal-year-close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fiscalYear: preview.fiscalYear }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Commit failed')
      setDone(
        d.alreadyClosed
          ? `FY${preview.fiscalYear} was already closed.`
          : `FY${preview.fiscalYear} closed. Net income ${formatCurrency(d.netIncome ?? preview.netIncome, 'CAD', { includeCode: false })} rolled into Retained Earnings; books locked through ${preview.periodEnd}.`
      )
      await loadPreview()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setCommitting(false)
    }
  }

  const totalDebit = preview ? preview.closingLines.reduce((s, l) => s + l.debit, 0) : 0
  const totalCredit = preview ? preview.closingLines.reduce((s, l) => s + l.credit, 0) : 0

  return (
    <div className="space-y-6">
      {error && <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}
      {done && <div className="p-3 bg-[#E3FCEF] text-[#006644] text-sm rounded">{done}</div>}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">Fiscal year</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Year ending Dec 31</span>
            <input
              type="number"
              value={fiscalYear}
              onChange={(e) => setFiscalYear(e.target.value)}
              min={1990}
              max={2200}
              className={inputCls + ' w-32 font-mono text-right'}
            />
          </label>
          <button
            onClick={loadPreview}
            disabled={loading}
            className="px-5 py-2 bg-[#0075DD] hover:bg-[#005FB3] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {loading ? 'Computing…' : 'Preview close'}
          </button>
        </div>
      </div>

      {preview && (
        <>
          {preview.alreadyClosed && (
            <div className="p-3 bg-[#FFF7E6] text-[#8B5A00] text-sm rounded border border-[#FFE8B3]">
              FY{preview.fiscalYear} was already closed on{' '}
              {new Date(preview.alreadyClosed.closedAt).toLocaleDateString()} · net income{' '}
              {formatCurrency(preview.alreadyClosed.netIncome, 'CAD', { includeCode: false })}.
            </div>
          )}
          {preview.warnings.map((w, i) => (
            <div key={i} className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{w}</div>
          ))}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Stat label="Total income" value={preview.totalIncome} />
            <Stat label="Total expense" value={preview.totalExpense} />
            <Stat label="Net income" value={preview.netIncome} emphasize />
          </div>

          <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E1E6EB] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#001B40]">
                Closing entries — {preview.periodStart} to {preview.periodEnd}
              </h2>
              {preview.retainedEarnings && (
                <span className="text-xs text-[#576981]">
                  Retained Earnings: <span className="font-mono">{preview.retainedEarnings.accountNumber}</span>{' '}
                  {preview.retainedEarnings.accountName}
                </span>
              )}
            </div>

            {preview.closingLines.length === 0 ? (
              <div className="p-12 text-center text-sm text-[#576981]">
                No income or expense activity in FY{preview.fiscalYear}.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#F5F7FA]">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Account</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Class</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Year balance</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Debit</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.accountId} className="border-t border-[#E1E6EB]">
                      <td className="px-3 py-2 text-[#001B40]">
                        <span className="font-mono text-xs text-[#576981] mr-2">{r.accountNumber}</span>
                        {r.accountName}
                      </td>
                      <td className="px-3 py-2 text-xs text-[#576981] capitalize">{r.accountClass}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatCurrency(r.balance, 'CAD', { includeCode: false })}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.debit ? formatCurrency(r.debit, 'CAD', { includeCode: false }) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {r.credit ? formatCurrency(r.credit, 'CAD', { includeCode: false }) : '—'}
                      </td>
                    </tr>
                  ))}
                  {preview.retainedEarnings &&
                    Math.abs(preview.netIncome) >= 0.005 && (
                      <tr className="border-t border-[#E1E6EB] bg-[#F8FBFF]">
                        <td className="px-3 py-2 text-[#001B40]">
                          <span className="font-mono text-xs text-[#576981] mr-2">
                            {preview.retainedEarnings.accountNumber}
                          </span>
                          {preview.retainedEarnings.accountName}
                          <span className="ml-2 text-xs text-[#576981]">
                            ({preview.netIncome >= 0 ? 'net income' : 'net loss'})
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-[#576981]">equity</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right font-mono">
                          {preview.netIncome < 0
                            ? formatCurrency(-preview.netIncome, 'CAD', { includeCode: false })
                            : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {preview.netIncome > 0
                            ? formatCurrency(preview.netIncome, 'CAD', { includeCode: false })
                            : '—'}
                        </td>
                      </tr>
                    )}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
                    <td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">
                      Totals:
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      {formatCurrency(totalDebit, 'CAD', { includeCode: false })}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      {formatCurrency(totalCredit, 'CAD', { includeCode: false })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}

            <div className="px-4 py-3 border-t border-[#E1E6EB] flex items-center justify-between">
              <span className="text-xs text-[#576981]">
                Committing posts a balanced closing JE dated {preview.periodEnd} and locks the books
                through that date.
              </span>
              <button
                onClick={commit}
                disabled={
                  committing ||
                  preview.alreadyClosed !== null ||
                  !preview.retainedEarnings ||
                  preview.closingLines.length === 0
                }
                className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {committing
                  ? 'Closing…'
                  : preview.alreadyClosed
                    ? 'Already closed'
                    : `Commit close FY${preview.fiscalYear}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const inputCls =
  'h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Stat({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  return (
    <div className={`bg-white rounded-lg border p-4 ${emphasize ? 'border-[#001B40]' : 'border-[#E1E6EB]'}`}>
      <div className="text-xs font-medium text-[#576981]">{label}</div>
      <div
        className={`mt-1 font-mono font-semibold ${emphasize ? 'text-xl' : 'text-base'} ${
          value < 0 ? 'text-[#BF2600]' : 'text-[#001B40]'
        }`}
      >
        {formatCurrency(value, 'CAD', { includeCode: false })}
      </div>
    </div>
  )
}
