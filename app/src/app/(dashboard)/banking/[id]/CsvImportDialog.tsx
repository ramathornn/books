'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/utils'
import { parseCsvRows } from '@/lib/csv'
import {
  PRESETS,
  detectPreset,
  detectDateOrder,
  mapRows,
  type ColumnMap,
  type DateFormat,
} from '@/lib/bankCsvMap'

interface Props {
  isOpen: boolean
  onClose: () => void
  bankAccountId: string
  currency: string
  accountType: string
  onImported: () => void
}

interface ParsedRow {
  date: string // YYYY-MM-DD
  description: string
  amount: number // negative = out, positive = in
  balanceAfter?: number
  raw: Record<string, string>
}

interface PreviewResponse {
  rowsTotal: number
  rowsToImport: number
  rowsDuplicate: number
  rowsInvalid: number
  rowsSkippedLocked: number
  lockedThrough: string | null
  sample: ParsedRow[]
}

export default function CsvImportDialog({
  isOpen,
  onClose,
  bankAccountId,
  accountType,
  currency,
  onImported,
}: Props) {
  const [step, setStep] = useState<'upload' | 'map' | 'preview' | 'done'>('upload')
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<string[][]>([])
  const [presetKey, setPresetKey] = useState<string>('rbc_business')
  const [columnMap, setColumnMap] = useState<ColumnMap>({
    date: '',
    description: '',
    amount: '',
    amountIn: '',
    amountOut: '',
    balance: '',
    amountSign: 'standard',
    dateFormat: 'auto',
  })
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)

  function reset() {
    setStep('upload')
    setHeaders([])
    setRawRows([])
    setColumnMap({ date: '', description: '', amount: '', amountIn: '', amountOut: '', balance: '', amountSign: 'standard', dateFormat: 'auto' })
    setError('')
    setPreview(null)
  }

  function applyPreset(key: string) {
    setPresetKey(key)
    const p = PRESETS[key] || {}
    setColumnMap((prev) => ({
      ...prev,
      ...p,
      // only carry over fields that match actual headers
      date: p.date && headers.includes(p.date) ? p.date : prev.date,
      description: p.description && headers.includes(p.description) ? p.description : prev.description,
      amount: p.amount && headers.includes(p.amount) ? p.amount : '',
      amountIn: p.amountIn && headers.includes(p.amountIn) ? p.amountIn : '',
      amountOut: p.amountOut && headers.includes(p.amountOut) ? p.amountOut : '',
      balance: p.balance && headers.includes(p.balance) ? p.balance : '',
      amountSign: p.amountSign || prev.amountSign,
    }))
  }

  async function handleFile(f: File) {
    setError('')
    const text = await f.text()
    const { headers: h, rows } = parseCsvRows(text)
    if (h.length === 0) {
      setError('Could not parse CSV.')
      return
    }
    setHeaders(h)
    setRawRows(rows)

    // Heuristic preset selection (shared with the API).
    const detected = detectPreset(h)
    if (detected !== 'custom') {
      setPresetKey(detected)
      applyPreset(detected)
    }

    setStep('map')
  }

  function buildPreview(): ParsedRow[] {
    return mapRows(headers, rawRows, columnMap).map((r) => ({
      date: r.date,
      description: r.description,
      amount: r.amount,
      balanceAfter: r.balanceAfter ?? undefined,
      raw: r.raw,
    }))
  }

  async function preflight() {
    setError('')
    setImporting(true)
    try {
      const rows = buildPreview()
      if (rows.length === 0) {
        throw new Error('No valid rows could be parsed. Check your column mappings.')
      }
      const res = await fetch('/api/bank-transactions/import?dryRun=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId, rows }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Preview failed')
      }
      const data = await res.json()
      setPreview({ ...data, sample: rows.slice(0, 10) })
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setImporting(false)
    }
  }

  async function commit() {
    setError('')
    setImporting(true)
    try {
      const rows = buildPreview()
      const res = await fetch('/api/bank-transactions/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankAccountId, rows }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Import failed')
      }
      setStep('done')
      setTimeout(() => {
        onImported()
        reset()
      }, 800)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        onClose()
        reset()
      }}
      title="Import CSV"
    >
      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      {step === 'upload' && (
        <div>
          <p className="text-sm text-[#576981] mb-3">
            Drop your bank CSV here. We&apos;ll match the columns next.
          </p>
          <label className="block border-2 border-dashed border-[#E1E6EB] rounded p-6 text-center hover:border-[#0075DD] transition-colors cursor-pointer">
            <svg className="w-10 h-10 mx-auto text-[#8C9BAB] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <div className="text-sm text-[#001B40]">Click to select a CSV</div>
            <div className="text-xs text-[#576981] mt-1">RBC, Wise, or any standard bank export</div>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
          </label>
        </div>
      )}

      {step === 'map' && (
        <div>
          <p className="text-sm text-[#576981] mb-3">
            Map the columns. Found <strong>{rawRows.length}</strong> rows in the CSV.
          </p>

          <div className="mb-3">
            <label className="block text-xs font-medium text-[#576981] mb-1">Bank preset</label>
            <select
              value={presetKey}
              onChange={(e) => applyPreset(e.target.value)}
              className={inputCls + ' bg-white'}
            >
              <option value="rbc_business">RBC business chequing/savings</option>
              <option value="rbc_personal">RBC personal chequing</option>
              <option value="wise">Wise multi-currency</option>
              <option value="custom">Custom</option>
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-[#576981] mb-1">Amount columns</label>
            <select
              value={columnMap.amountSign}
              onChange={(e) => setColumnMap((m) => ({ ...m, amountSign: e.target.value as ColumnMap['amountSign'] }))}
              className={inputCls + ' bg-white'}
            >
              <option value="standard">Single column (negative = money out)</option>
              <option value="split-in-out">Two columns (Money In / Money Out)</option>
              <option value="cc-flip">Credit card (charges as positive — flip sign)</option>
            </select>
            {accountType === 'credit_card' && columnMap.amountSign === 'standard' && (
              <p className="text-[11px] text-[#BF2600] mt-1">
                Heads-up: this is a credit card account. If charges show up as positive in your CSV, switch to &ldquo;Credit card&rdquo; mapping.
              </p>
            )}
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium text-[#576981] mb-1">Date format</label>
            <select
              value={columnMap.dateFormat}
              onChange={(e) => setColumnMap((m) => ({ ...m, dateFormat: e.target.value as DateFormat }))}
              className={inputCls + ' bg-white'}
            >
              <option value="auto">Auto-detect</option>
              <option value="mdy">Month / Day / Year</option>
              <option value="dmy">Day / Month / Year</option>
              <option value="iso">ISO (YYYY-MM-DD)</option>
            </select>
            {columnMap.dateFormat === 'auto' && columnMap.date && (
              <p className="text-[11px] text-[#576981] mt-1">
                Detected:{' '}
                {detectDateOrder(rawRows.map((r) => r[headers.indexOf(columnMap.date)] || '')) === 'dmy'
                  ? 'Day / Month / Year'
                  : 'Month / Day / Year'}
                . Override here if a date looks wrong in the preview.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field label="Date column">
              <ColumnPicker headers={headers} value={columnMap.date} onChange={(v) => setColumnMap((m) => ({ ...m, date: v }))} />
            </Field>
            <Field label="Description column">
              <ColumnPicker headers={headers} value={columnMap.description} onChange={(v) => setColumnMap((m) => ({ ...m, description: v }))} />
            </Field>
            {columnMap.amountSign === 'split-in-out' ? (
              <>
                <Field label="Money In column">
                  <ColumnPicker headers={headers} value={columnMap.amountIn} onChange={(v) => setColumnMap((m) => ({ ...m, amountIn: v }))} />
                </Field>
                <Field label="Money Out column">
                  <ColumnPicker headers={headers} value={columnMap.amountOut} onChange={(v) => setColumnMap((m) => ({ ...m, amountOut: v }))} />
                </Field>
              </>
            ) : (
              <Field label="Amount column">
                <ColumnPicker headers={headers} value={columnMap.amount} onChange={(v) => setColumnMap((m) => ({ ...m, amount: v }))} />
              </Field>
            )}
            <Field label="Balance column (optional)">
              <ColumnPicker headers={headers} value={columnMap.balance} onChange={(v) => setColumnMap((m) => ({ ...m, balance: v }))} />
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E1E6EB]">
            <button onClick={reset} className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]">
              Back
            </button>
            <button
              onClick={preflight}
              disabled={importing}
              className="px-5 py-2 bg-[#0075DD] hover:bg-[#005FB3] text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {importing ? 'Checking…' : 'Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && preview && (
        <div>
          <p className="text-sm text-[#576981] mb-3">
            Found <strong>{preview.rowsTotal}</strong> rows.{' '}
            <strong className="text-[#216E39]">{preview.rowsToImport}</strong> will be imported.
            {preview.rowsDuplicate > 0 && (
              <>
                {' '}
                <strong className="text-[#BF2600]">{preview.rowsDuplicate}</strong> already exist (skipped).
              </>
            )}
            {preview.rowsInvalid > 0 && (
              <>
                {' '}
                <strong>{preview.rowsInvalid}</strong> were skipped as invalid.
              </>
            )}
            {preview.rowsSkippedLocked > 0 && (
              <>
                {' '}
                <strong className="text-[#BF2600]">{preview.rowsSkippedLocked}</strong> fall in the
                locked period (on or before {preview.lockedThrough}) and were skipped.
              </>
            )}
          </p>

          <div className="border border-[#E1E6EB] rounded overflow-x-auto max-h-[300px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-[#F5F7FA] sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-[#576981]">Date</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-[#576981]">Description</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-[#576981]">Amount</th>
                </tr>
              </thead>
              <tbody>
                {preview.sample.map((r, i) => (
                  <tr key={i} className="border-t border-[#E1E6EB]">
                    <td className="px-2 py-1.5 text-[#001B40] whitespace-nowrap">{r.date}</td>
                    <td className="px-2 py-1.5 text-[#001B40] truncate max-w-[260px]" title={r.description}>{r.description}</td>
                    <td className={`px-2 py-1.5 text-right font-mono ${r.amount < 0 ? 'text-[#BF2600]' : 'text-[#216E39]'}`}>
                      {formatCurrency(r.amount, currency, { includeCode: false })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-[#E1E6EB]">
            <button onClick={() => setStep('map')} className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]">
              Back
            </button>
            <button
              onClick={commit}
              disabled={importing || preview.rowsToImport === 0}
              className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {importing ? 'Importing…' : `Import ${preview.rowsToImport} rows`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div className="py-8 text-center">
          <div className="text-3xl mb-2">✓</div>
          <p className="text-sm text-[#001B40]">Import complete.</p>
        </div>
      )}
    </Modal>
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

function ColumnPicker({
  headers,
  value,
  onChange,
}: {
  headers: string[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls + ' bg-white'}>
      <option value="">— None —</option>
      {headers.map((h) => (
        <option key={h} value={h}>{h}</option>
      ))}
    </select>
  )
}
