'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'

interface ComputedYear {
  taxYear: number
  classId: string
  classNumber: string
  locked: boolean
  status: string
  isCatchUp: boolean
  catchUpForYear: number | null
  isOverridden: boolean
  journalEntryId: string | null
  openingUcc: number
  additions: number
  dispositions: number
  halfYearAdjustment: number
  accIiAddition: number
  ccaRate: number
  ccaBase: number
  ccaMax: number
  ccaClaimed: number
  closingUcc: number
  method: string
  recapture: boolean
  terminalLossPossible: boolean
}

interface PreviewLine {
  glAccountId: string
  description: string
  debit: number
  credit: number
  account: { accountNumber: string; accountName: string } | null
}

interface ApiResponse {
  class: { id: string; classNumber: string; description: string; rate: number; expenseAccountId: string | null; accumDepAccountId: string | null }
  year: ComputedYear
  journalPreview: { lines: PreviewLine[]; amount: number; missingAccounts: boolean }
  prevYear: ComputedYear | null
  nextYear: ComputedYear | null
}

const money = (n: number) => formatCurrency(n, 'CAD', { includeCode: false })

export default function CcaYearEditorClient({ classId, taxYear }: { classId: string; taxYear: number }) {
  const router = useRouter()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [additions, setAdditions] = useState('')
  const [dispositions, setDispositions] = useState('')
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/cca/${classId}/${taxYear}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to load')
      setData(d)
      setAdditions(d.year.additions ? String(d.year.additions) : '')
      setDispositions(d.year.dispositions ? String(d.year.dispositions) : '')
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [classId, taxYear])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cca/${classId}/${taxYear}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          additions: parseFloat(additions || '0'),
          dispositions: parseFloat(dispositions || '0'),
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to save')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function post() {
    if (!data) return
    if (!confirm(`Post the ${taxYear} CCA claim for class ${data.class.classNumber} (${money(data.journalPreview.amount)})? This books a journal entry dated fiscal year-end.`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cca/${classId}/${taxYear}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to post')
      await load()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  async function unpost() {
    if (!confirm('Reverse the posted CCA claim for this year? A reversing journal entry will be booked.')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/cca/${classId}/${taxYear}/unpost`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to unpost')
      await load()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="text-sm text-[#576981]">Loading…</div>
  if (error && !data) return <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
  if (!data) return null

  const { year } = data
  const posted = !!year.journalEntryId
  const readOnly = year.locked || posted

  return (
    <div className="space-y-6 max-w-3xl">
      {error && <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}

      {year.locked && (
        <div className="p-3 bg-[#EEF1F4] text-[#576981] text-sm rounded border border-[#E1E6EB]">
          {taxYear} is in a locked period — view only. Prior-year corrections book as a catch-up in the
          first open year.
        </div>
      )}
      {year.isCatchUp && (
        <div className="p-3 bg-[#FFF7E6] text-[#8B5A00] text-sm rounded border border-[#FFE8B3]">
          This year carries a catch-up adjustment for prior-year corrections{year.catchUpForYear ? ` (from ${year.catchUpForYear})` : ''}.
        </div>
      )}

      {/* Inputs */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">Activity</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Additions (acquisitions)</span>
            <input
              type="number"
              disabled={readOnly}
              value={readOnly ? year.additions || '' : additions}
              onChange={(e) => { setAdditions(e.target.value); setDirty(true) }}
              className="h-9 w-full px-3 border border-[#E1E6EB] rounded text-sm text-right font-mono disabled:bg-[#F5F7FA]"
              placeholder="0.00"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Dispositions (proceeds)</span>
            <input
              type="number"
              disabled={readOnly}
              value={readOnly ? year.dispositions || '' : dispositions}
              onChange={(e) => { setDispositions(e.target.value); setDirty(true) }}
              className="h-9 w-full px-3 border border-[#E1E6EB] rounded text-sm text-right font-mono disabled:bg-[#F5F7FA]"
              placeholder="0.00"
            />
          </label>
        </div>
        {!readOnly && (
          <button
            onClick={save}
            disabled={busy || !dirty}
            className="mt-3 px-4 py-2 bg-white border border-[#E1E6EB] text-[#001B40] text-sm font-medium rounded hover:bg-[#F5F7FA] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Recompute'}
          </button>
        )}
      </div>

      {/* Computed schedule */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB]">
          <h2 className="text-sm font-semibold text-[#001B40]">Computation ({year.method.replace('_', '-')})</h2>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <Row label="Opening UCC" value={year.openingUcc} />
            <Row label="Additions" value={year.additions} />
            <Row label="Dispositions" value={year.dispositions} negative />
            {year.halfYearAdjustment > 0 && <Row label="Half-year adjustment" value={year.halfYearAdjustment} negative />}
            {year.accIiAddition > 0 && <Row label="AccII uplift" value={year.accIiAddition} />}
            <Row label={`CCA base × ${(year.ccaRate * 100).toFixed(2)}%`} value={year.ccaBase} muted />
            <Row label="CCA claimed" value={year.ccaClaimed} emphasize />
            <Row label="Closing UCC" value={year.closingUcc} emphasize danger={year.recapture} />
          </tbody>
        </table>
        {year.recapture && (
          <div className="px-4 py-2 text-xs text-[#BF2600] bg-[#FDECEA]">
            Closing UCC is negative — this is a recapture of CCA into income.
          </div>
        )}
        {year.terminalLossPossible && (
          <div className="px-4 py-2 text-xs text-[#8B5A00] bg-[#FFF7E6]">
            Positive UCC with the class emptied by disposition — a terminal loss may apply.
          </div>
        )}
      </div>

      {/* CCA Journal Preview */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#001B40]">Journal preview (entry date = fiscal year-end)</h2>
          {posted && <span className="text-xs text-[#006644]">Posted</span>}
        </div>
        {data.journalPreview.missingAccounts ? (
          <div className="p-6 text-sm text-[#BF2600]">
            This class has no depreciation expense / accumulated amortization account.{' '}
            <Link href="/accounting/cca/setup" className="underline">Configure accounts</Link>.
          </div>
        ) : data.journalPreview.amount <= 0 ? (
          <div className="p-6 text-sm text-[#576981]">No CCA to claim this year — nothing to post.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[#F5F7FA]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Account</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Debit</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.journalPreview.lines.map((l, i) => (
                <tr key={i} className="border-t border-[#E1E6EB]">
                  <td className="px-3 py-2 text-[#001B40]">
                    {l.account ? (
                      <>
                        <span className="font-mono text-xs text-[#576981] mr-2">{l.account.accountNumber}</span>
                        {l.account.accountName}
                      </>
                    ) : (
                      l.glAccountId
                    )}
                    <span className="block text-xs text-[#576981]">{l.description}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{l.debit ? money(l.debit) : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{l.credit ? money(l.credit) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {!posted && !year.locked && (
          <button
            onClick={post}
            disabled={busy || data.journalPreview.missingAccounts || data.journalPreview.amount <= 0}
            className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            {busy ? 'Posting…' : `Post CCA ${money(data.journalPreview.amount)}`}
          </button>
        )}
        {posted && !year.locked && (
          <button
            onClick={unpost}
            disabled={busy}
            className="px-5 py-2 bg-white border border-[#BF2600] text-[#BF2600] text-sm font-medium rounded hover:bg-[#FDECEA] disabled:opacity-50"
          >
            {busy ? 'Reversing…' : 'Unpost / reverse'}
          </button>
        )}
        <Link href={`/accounting/cca/${classId}/history`} className="text-sm text-[#0075DD] hover:underline">
          Class history →
        </Link>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  negative,
  emphasize,
  muted,
  danger,
}: {
  label: string
  value: number
  negative?: boolean
  emphasize?: boolean
  muted?: boolean
  danger?: boolean
}) {
  return (
    <tr className="border-t border-[#E1E6EB]">
      <td className={`px-4 py-2 ${muted ? 'text-[#576981]' : 'text-[#001B40]'} ${emphasize ? 'font-semibold' : ''}`}>
        {label}
      </td>
      <td
        className={`px-4 py-2 text-right font-mono ${emphasize ? 'font-semibold' : ''} ${
          danger ? 'text-[#BF2600]' : ''
        }`}
      >
        {negative && value ? `(${money(value)})` : money(value)}
      </td>
    </tr>
  )
}
