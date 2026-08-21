'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface PreviewRow {
  accountId: string
  accountNumber: string
  accountName: string
  currency: string
  nativeBalance: number
  rate: number
  cadAtSnapshot: number
  unrealized: number
}

interface PreviewResponse {
  asOf: string
  rows: PreviewRow[]
  totalUnrealized: number
  currenciesNeeded: string[]
}

function defaultEoMonth() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
}

export default function FxRevaluationClient() {
  const router = useRouter()
  const [asOf, setAsOf] = useState(defaultEoMonth())
  const [rates, setRates] = useState<Record<string, string>>({ USD: '', EUR: '', GBP: '', AUD: '' })
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState('')

  function setRate(ccy: string, value: string) {
    setRates((r) => ({ ...r, [ccy]: value }))
  }

  async function loadPreview() {
    setError('')
    setLoading(true)
    try {
      const numericRates: Record<string, number> = {}
      Object.entries(rates).forEach(([ccy, val]) => {
        const n = parseFloat(val)
        if (!isNaN(n) && n > 0) numericRates[ccy] = n
      })
      const res = await fetch('/api/fx-revaluation/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOf, rates: numericRates }),
      })
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

  async function postRevaluation() {
    if (!preview) return
    if (!confirm(`Post unrealized FX gain/loss of ${formatCurrency(preview.totalUnrealized, 'CAD', { includeCode: false })} as a balanced JE on ${preview.asOf}?`)) return
    setPosting(true)
    try {
      const res = await fetch('/api/fx-revaluation/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asOf: preview.asOf, rows: preview.rows }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Post failed')
      }
      setPreview(null)
      router.refresh()
      alert('FX revaluation posted.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">Setup</h2>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          <Field label="As of date">
            <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={inputCls} />
          </Field>
          {(['USD', 'EUR', 'GBP', 'AUD'] as const).map((ccy) => (
            <Field key={ccy} label={`${ccy} → CAD rate`}>
              <input
                type="number"
                step="0.0001"
                value={rates[ccy] || ''}
                onChange={(e) => setRate(ccy, e.target.value)}
                placeholder="e.g. 1.36"
                className={inputCls + ' font-mono text-right'}
              />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end">
          <button
            onClick={loadPreview}
            disabled={loading}
            className="px-5 py-2 bg-[#0075DD] hover:bg-[#005FB3] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {loading ? 'Computing…' : 'Compute revaluation'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#E1E6EB] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#001B40]">Preview</h2>
            {preview.currenciesNeeded.length > 0 ? (
              <span className="text-xs text-[#BF2600]">
                Missing rates for: {preview.currenciesNeeded.join(', ')}
              </span>
            ) : null}
          </div>

          {preview.rows.length === 0 ? (
            <div className="p-12 text-center text-sm text-[#576981]">
              No non-CAD account balances at this date.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Account</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">CCY</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Native bal.</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Rate</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">CAD @ snapshot</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Unrealized</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.accountId} className="border-t border-[#E1E6EB]">
                    <td className="px-3 py-2 text-[#001B40]">
                      <span className="font-mono text-xs text-[#576981] mr-2">{r.accountNumber}</span>
                      {r.accountName}
                    </td>
                    <td className="px-3 py-2 text-xs text-[#576981]">{r.currency}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(r.nativeBalance, r.currency, { includeCode: false })}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{r.rate.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(r.cadAtSnapshot, 'CAD', { includeCode: false })}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${r.unrealized < 0 ? 'text-[#BF2600]' : 'text-[#216E39]'}`}>
                      {formatCurrency(r.unrealized, 'CAD', { includeCode: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
                  <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">
                    Net unrealized FX:
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${preview.totalUnrealized < 0 ? 'text-[#BF2600]' : 'text-[#216E39]'}`}>
                    {formatCurrency(preview.totalUnrealized, 'CAD', { includeCode: false })}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {preview.rows.length > 0 && (
            <div className="px-4 py-3 border-t border-[#E1E6EB] flex items-center justify-end">
              <button
                onClick={postRevaluation}
                disabled={posting || Math.abs(preview.totalUnrealized) < 0.005}
                className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {posting ? 'Posting…' : 'Post revaluation JE'}
              </button>
            </div>
          )}
        </div>
      )}
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
