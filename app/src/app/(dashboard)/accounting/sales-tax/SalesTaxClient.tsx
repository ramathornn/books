'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { GST34_LINES } from '@/lib/tax/descriptors/gst34Lines'

interface Filing {
  id: string
  periodStart: string
  periodEnd: string
  collected: number
  paid: number
  net: number
  status: string
  filedAt: string | null
}

interface Gst34Lines {
  line101: number
  line103: number
  line104: number
  line105: number
  line106: number
  line107: number
  line108: number
  line109: number
}

interface SourceRef {
  gstPayableAccountId: string | null
  collected: number
  itcs: number
  revenue: number
  journalEntryLineCount: number
}

interface Preview {
  period: { start: string; end: string }
  lines: Gst34Lines
  sourceRef: SourceRef
  excludedIncomeAccountIds: string[]
}

interface Props {
  filings: Filing[]
}

function defaultQuarterStart() {
  const now = new Date()
  const m = now.getMonth()
  const qStart = Math.floor(m / 3) * 3 - 3
  const y = qStart < 0 ? now.getFullYear() - 1 : now.getFullYear()
  const month = ((qStart % 12) + 12) % 12
  return new Date(y, month, 1).toISOString().slice(0, 10)
}
function defaultQuarterEnd() {
  const now = new Date()
  const m = now.getMonth()
  const qStart = Math.floor(m / 3) * 3 - 3
  const y = qStart < 0 ? now.getFullYear() - 1 : now.getFullYear()
  const month = ((qStart % 12) + 12) % 12
  return new Date(y, month + 3, 0).toISOString().slice(0, 10)
}

// Lines the filer keys directly into CRA GST/HST NETFILE (the entry helper).
const NETFILE_KEYS = GST34_LINES.filter((d) => d.netfileHelper).map((d) => d.key)

export default function SalesTaxClient({ filings }: Props) {
  const router = useRouter()
  const [start, setStart] = useState(defaultQuarterStart())
  const [end, setEnd] = useState(defaultQuarterEnd())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [line104, setLine104] = useState('0')
  const [line107, setLine107] = useState('0')
  const [notes, setNotes] = useState('')
  const [filing, setFiling] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)

  async function loadPreview() {
    setError('')
    setLoading(true)
    try {
      const sp = new URLSearchParams({ start, end })
      const res = await fetch(`/api/sales-tax/gst34?${sp}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Preview failed')
      }
      const data: Preview = await res.json()
      setPreview(data)
      setLine104('0')
      setLine107('0')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  // Re-derive the worksheet lines applying the user's manual 104/107 adjustments.
  function effectiveLines(): Gst34Lines | null {
    if (!preview) return null
    const round = (x: number) => Math.round(x * 100) / 100
    const l = preview.lines
    const adj104 = round(parseFloat(line104 || '0') || 0)
    const adj107 = round(parseFloat(line107 || '0') || 0)
    const line105 = round(l.line103 + adj104)
    const line108 = round(l.line106 + adj107)
    return {
      line101: l.line101,
      line103: l.line103,
      line104: adj104,
      line105,
      line106: l.line106,
      line107: adj107,
      line108,
      line109: round(line105 - line108),
    }
  }

  async function file() {
    const lines = effectiveLines()
    if (!preview || !lines) return
    if (!confirm(`File GST/HST for ${preview.period.start} → ${preview.period.end}? This posts a remittance JE and freezes the worksheet snapshot.`)) return
    setError('')
    setFiling(true)
    try {
      const res = await fetch('/api/sales-tax/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: preview.period.start,
          periodEnd: preview.period.end,
          lines,
          sourceRef: preview.sourceRef,
          notes,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'File failed')
      }
      setPreview(null)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setFiling(false)
    }
  }

  async function copyValue(key: string, value: number) {
    try {
      await navigator.clipboard.writeText(value.toFixed(2))
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  const lines = effectiveLines()
  const isRefund = lines ? lines.line109 < 0 : false

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">Compute GST34 worksheet</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <Field label="Period start">
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Period end">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
          </Field>
          <div className="flex items-end">
            <button
              onClick={loadPreview}
              disabled={loading}
              className="w-full h-9 px-4 text-sm font-medium text-white bg-[#0075DD] hover:bg-[#005FB3] rounded disabled:opacity-50"
            >
              {loading ? 'Computing…' : 'Compute'}
            </button>
          </div>
        </div>

        {preview && lines && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Line 104 — adjustments added to net tax">
                <input
                  type="number"
                  step="0.01"
                  value={line104}
                  onChange={(e) => setLine104(e.target.value)}
                  className={inputCls + ' font-mono text-right'}
                />
              </Field>
              <Field label="Line 107 — adjustments deducted from net tax">
                <input
                  type="number"
                  step="0.01"
                  value={line107}
                  onChange={(e) => setLine107(e.target.value)}
                  className={inputCls + ' font-mono text-right'}
                />
              </Field>
              <Field label="Notes">
                <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
              </Field>
            </div>

            {/* Line-numbered worksheet */}
            <div className="border border-[#E1E6EB] rounded overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#F5F7FA]">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981] w-16">Line</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Description</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {GST34_LINES.map((d) => {
                    const value = (lines as unknown as Record<string, number>)[d.key] ?? 0
                    const isNet = d.key === 'line109'
                    return (
                      <tr
                        key={d.key}
                        className="border-t border-[#E1E6EB]"
                        style={{ backgroundColor: isNet ? '#F5F7FA' : undefined }}
                      >
                        <td className="px-3 py-2 font-mono font-semibold text-[#001B40]">{d.officialNumber}</td>
                        <td className="px-3 py-2">
                          {d.label}
                          {d.derived && <span className="ml-2 text-[10px] text-[#576981] uppercase">derived</span>}
                        </td>
                        <td
                          className={`px-3 py-2 text-right font-mono ${isNet ? 'font-semibold text-[#001B40]' : ''}`}
                          style={isNet && isRefund ? { color: '#BF2600' } : undefined}
                        >
                          {formatCurrency(value, 'CAD', { includeCode: false })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {isRefund && (
              <div className="p-3 bg-[#FFF4E5] text-[#996B00] text-xs rounded">
                Line 109 is negative ({formatCurrency(lines.line109, 'CAD', { includeCode: false })}) — this period is a
                NET REFUND. Confirm before filing.
              </div>
            )}

            {/* NETFILE entry helper */}
            <div className="border border-[#CBE3FB] bg-[#F2F8FE] rounded p-4">
              <h3 className="text-sm font-semibold text-[#001B40] mb-1">NETFILE entry helper</h3>
              <p className="text-xs text-[#576981] mb-3">
                Key these values into CRA GST/HST NETFILE. Click a value to copy it. (No transmit file is produced.)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {NETFILE_KEYS.map((key) => {
                  const d = GST34_LINES.find((x) => x.key === key)!
                  const value = (lines as unknown as Record<string, number>)[key] ?? 0
                  return (
                    <button
                      key={key}
                      onClick={() => copyValue(key, value)}
                      className="flex items-center justify-between gap-2 px-3 py-2 bg-white border border-[#CBE3FB] rounded text-left hover:border-[#0075DD] transition-colors"
                    >
                      <span className="text-[11px] text-[#576981]">
                        <span className="font-mono font-semibold text-[#001B40]">{d.officialNumber}</span> {d.label}
                      </span>
                      <span className="font-mono text-sm text-[#001B40] whitespace-nowrap">
                        {copied === key ? 'Copied!' : value.toFixed(2)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href={`/api/sales-tax/gst34/print?${new URLSearchParams({ start: preview.period.start, end: preview.period.end })}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-9 px-4 inline-flex items-center text-sm font-medium text-[#0075DD] border border-[#0075DD] hover:bg-[#F2F8FE] rounded"
              >
                Print worksheet PDF
              </a>
              <button
                onClick={file}
                disabled={filing}
                className="h-9 px-4 text-sm font-medium text-white bg-[#038A06] hover:bg-[#026e05] rounded disabled:opacity-50"
              >
                {filing ? 'Filing…' : `Mark filed (net ${formatCurrency(lines.line109, 'CAD', { includeCode: false })})`}
              </button>
            </div>

            {preview.sourceRef.journalEntryLineCount > 0 && (
              <p className="text-[11px] text-[#576981]">
                Computed from {preview.sourceRef.journalEntryLineCount} posted GST line
                {preview.sourceRef.journalEntryLineCount === 1 ? '' : 's'}
                {preview.excludedIncomeAccountIds.length > 0 &&
                  ` · Line 101 excludes ${preview.excludedIncomeAccountIds.length} non-supply income account${
                    preview.excludedIncomeAccountIds.length === 1 ? '' : 's'
                  } (FX gains / interest)`}
                .
              </p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB]">
          <h2 className="text-base font-semibold text-[#001B40]">Filing history</h2>
        </div>
        {filings.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#576981]">No filings recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F5F7FA]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Period</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Line 105</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Line 108</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Line 109 (net)</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Filed</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Worksheet</th>
              </tr>
            </thead>
            <tbody>
              {filings.map((f) => (
                <tr key={f.id} className="border-t border-[#E1E6EB]">
                  <td className="px-3 py-2">{f.periodStart} → {f.periodEnd}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(f.collected, 'CAD', { includeCode: false })}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(f.paid, 'CAD', { includeCode: false })}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{formatCurrency(f.net, 'CAD', { includeCode: false })}</td>
                  <td className="px-3 py-2">
                    <span
                      className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
                      style={{
                        backgroundColor: f.status === 'filed' || f.status === 'paid' ? '#E6F4EA' : '#FFF8E5',
                        color: f.status === 'filed' || f.status === 'paid' ? '#216E39' : '#996B00',
                      }}
                    >
                      {f.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-[#576981]">{f.filedAt || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <a
                      href={`/api/sales-tax/gst34/print?${new URLSearchParams({ returnId: f.id })}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#0075DD] hover:underline"
                    >
                      PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
