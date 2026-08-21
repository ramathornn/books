'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { money2, round2 } from '@/lib/tax/round'
import { computeT1, type ComputeT1Context } from '@/lib/tax/t1/compute'
import { clientRateTable } from '@/lib/tax/t1/rates/clientTable'
import { lineDescriptorsFor } from '@/lib/tax/t1/lineDescriptors'
import {
  COUPLED_STATUSES,
  type DividendBreakdown,
  type MaritalStatus,
  type PulledRefs,
  type T1Lines,
  type T1Result,
  type T1Section,
  type ValidationIssue,
} from '@/lib/tax/t1/types'
import { isValidSinClient } from '@/app/(dashboard)/tax/_shared/luhn'
import SinBnInput from '@/app/(dashboard)/tax/_shared/SinBnInput'
import ReturnFormBuilder from '../_components/ReturnFormBuilder'

interface Filer {
  id: string
  name: string
  sinMasked: string | null
  hasSin: boolean
  dateOfBirth: string | null
  province: string
  address: string
}

interface ReturnState {
  province: string
  maritalStatus: MaritalStatus
  spouseFirstName: string
  spouseNetIncome: string
  hasSpouseSin: boolean
  notes: string
}

const MARITAL_OPTIONS: Array<{ value: MaritalStatus; label: string }> = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'commonLaw', label: 'Common-law' },
  { value: 'separated', label: 'Separated' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
]

const ALL_DESCRIPTORS = lineDescriptorsFor('T1')

function descriptorsForSection(section: T1Section) {
  return ALL_DESCRIPTORS.filter((d) => d.section === section)
}

const input =
  'w-full rounded-md border border-[#D9E1EC] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30'

/**
 * The T1 draft builder. Auto-pulled lines render read-only with provenance;
 * manual lines are inputs; computed lines (totals/tax/refund) are recomputed LIVE
 * client-side via the pure computeT1 on every keystroke. Save persists the draft;
 * Recompute re-pulls the slips + clears drift server-side; Prepare runs the verify
 * gate and freezes the return.
 */
export default function T1BuilderClient({ taxYear, filer }: { taxYear: number; filer: Filer }) {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Identity / return-level fields.
  const [ret, setRet] = useState<ReturnState>({
    province: filer.province || 'AB',
    maritalStatus: 'single',
    spouseFirstName: '',
    spouseNetIncome: '',
    hasSpouseSin: false,
    notes: '',
  })
  const [filerSin, setFilerSin] = useState('')
  const [spouseSin, setSpouseSin] = useState('')
  const [dob, setDob] = useState(filer.dateOfBirth ?? '')
  const [provinceConfirmed, setProvinceConfirmed] = useState(false)

  // Pulled slip data + manual overrides.
  const [pulledLines, setPulledLines] = useState<T1Lines>({})
  const [pulledRefs, setPulledRefs] = useState<PulledRefs | null>(null)
  const [dividends, setDividends] = useState<DividendBreakdown>({
    taxableEligible: 0,
    taxableNonEligible: 0,
    federalDtc: 0,
  })
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [pullIssues, setPullIssues] = useState<ValidationIssue[]>([])
  const [provinceSupported, setProvinceSupported] = useState(true)

  // Verify report from the last Prepare/Recompute call.
  const [report, setReport] = useState<{ ok: boolean; issues: ValidationIssue[] } | null>(null)
  const [driftLines, setDriftLines] = useState<Set<string>>(new Set())

  // ---- initial load ----
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/tax/t1/${taxYear}?partyId=${filer.id}`)
        const data = await res.json()
        if (!res.ok) {
          if (!cancelled) setError(data.error || 'Failed to load return')
          return
        }
        if (cancelled) return
        const r = data.return
        setRet({
          province: r.province || filer.province || 'AB',
          maritalStatus: (r.maritalStatus as MaritalStatus) || 'single',
          spouseFirstName: r.spouseFirstName ?? '',
          spouseNetIncome: r.spouseNetIncome != null ? String(r.spouseNetIncome) : '',
          hasSpouseSin: !!r.hasSpouseSin,
          notes: r.notes ?? '',
        })
        if (r.taxpayerDob) setDob(r.taxpayerDob)
        // Seed manual overrides from the saved linesOverride.
        const savedOverride = (r.linesOverride ?? {}) as Record<string, number>
        const ovStrings: Record<string, string> = {}
        for (const [k, v] of Object.entries(savedOverride)) ovStrings[k] = String(v)
        setOverrides(ovStrings)

        setPulledLines((data.pulled?.lines ?? {}) as T1Lines)
        setPulledRefs((data.pulled?.pulledRefs ?? null) as PulledRefs | null)
        setDividends(
          (data.pulled?.dividends ?? { taxableEligible: 0, taxableNonEligible: 0, federalDtc: 0 }) as DividendBreakdown,
        )
        setPullIssues((data.pulled?.issues ?? []) as ValidationIssue[])
        setProvinceSupported(!!data.provinceSupported)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [taxYear, filer.id, filer.province])

  const coupled = COUPLED_STATUSES.includes(ret.maritalStatus)

  // ---- effective lines (pull ∪ numeric overrides) ----
  const effectiveLines = useMemo<T1Lines>(() => {
    const out: T1Lines = { ...pulledLines }
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
    return out
  }, [pulledLines, overrides])

  // ---- live client-side compute (instant refund/owing) ----
  const result = useMemo<T1Result | null>(() => {
    try {
      const rateTable = clientRateTable(taxYear, ret.province)
      const ctx: ComputeT1Context = {
        maritalStatus: ret.maritalStatus,
        spouseNetIncome: coupled ? (ret.spouseNetIncome === '' ? null : Number(ret.spouseNetIncome)) : null,
        dateOfBirth: dob ? new Date(dob) : null,
        dividends,
      }
      return computeT1(effectiveLines, rateTable, ctx)
    } catch {
      return null
    }
  }, [taxYear, ret.province, ret.maritalStatus, ret.spouseNetIncome, coupled, dob, dividends, effectiveLines])

  const computedLines = result?.lines ?? effectiveLines

  function setOverride(line: string, value: string) {
    setOverrides((prev) => ({ ...prev, [line]: value }))
  }

  function overridePayload(): T1Lines {
    const out: T1Lines = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (Number.isFinite(n) && n >= 0) out[k] = n
    }
    return out
  }

  // ---- save draft ----
  const save = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!silent) setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/tax/t1/${taxYear}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partyId: filer.id,
            province: ret.province,
            maritalStatus: ret.maritalStatus,
            spouseFirstName: coupled ? ret.spouseFirstName : '',
            spouseNetIncome: coupled && ret.spouseNetIncome !== '' ? Number(ret.spouseNetIncome) : null,
            spouseSin: coupled && spouseSin ? spouseSin : undefined,
            filerSin: filerSin || undefined,
            taxpayerDob: dob || null,
            linesOverride: overridePayload(),
            notes: ret.notes,
          }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to save')
          return false
        }
        if (filerSin) setFilerSin('')
        if (spouseSin) setSpouseSin('')
        return true
      } finally {
        if (!silent) setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taxYear, filer.id, ret, coupled, spouseSin, filerSin, dob, overrides],
  )

  // ---- recompute (re-pull slips + clear drift server-side) ----
  async function recompute() {
    setBusy('recompute')
    setError(null)
    try {
      await save(true)
      const res = await fetch(`/api/tax/t1/${taxYear}/recompute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId: filer.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Recompute failed')
        return
      }
      setPulledLines((data.return?.lines ?? pulledLines) as T1Lines)
      setPulledRefs((data.return?.pulledRefs ?? pulledRefs) as PulledRefs | null)
      if (data.dividends) setDividends(data.dividends as DividendBreakdown)
      setReport(data.report ?? null)
      setDriftLines(new Set())
    } finally {
      setBusy(null)
    }
  }

  // ---- prepare (verify gate + freeze) ----
  async function prepare() {
    setBusy('prepare')
    setError(null)
    try {
      const saved = await save(true)
      if (!saved) return
      // First call without acknowledging warnings.
      let res = await fetch(`/api/tax/t1/${taxYear}/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId: filer.id }),
      })
      let data = await res.json()
      if (res.status === 409 && data.code === 'WARNINGS_UNACKNOWLEDGED') {
        const warnings = (data.report?.issues ?? []).filter((i: ValidationIssue) => i.level === 'warning')
        const ok = window.confirm(
          `Verification passed with ${warnings.length} warning(s):\n\n` +
            warnings.map((w: ValidationIssue) => `• ${w.message}`).join('\n') +
            '\n\nMark the return prepared anyway?',
        )
        if (!ok) {
          setReport(data.report ?? null)
          return
        }
        res = await fetch(`/api/tax/t1/${taxYear}/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partyId: filer.id, acknowledgeWarnings: true }),
        })
        data = await res.json()
      }
      if (!res.ok) {
        setReport(data.report ?? null)
        setError(data.error || 'Verification failed — resolve the errors below.')
        return
      }
      // Prepared → go to the read-only view.
      router.push(`/tax/t1/${taxYear}/view?partyId=${filer.id}`)
    } finally {
      setBusy(null)
    }
  }

  function downloadExport(format: 'json' | 'csv' | 'txt') {
    window.open(`/api/tax/t1/${taxYear}/export?partyId=${filer.id}&format=${format}`, '_blank')
  }

  // ---- summary rail figures ----
  const fedTax = result?.federal.netTax ?? 0
  const abTax = result?.provincial.netTax ?? 0
  const credits = round2((result?.federal.dividendTaxCredit ?? 0) + (result?.provincial.dividendTaxCredit ?? 0))
  const instalments = Number(overrides['47600'] ?? 0) || (pulledLines['47600'] ?? 0)
  const refund = result?.refund ?? 0
  const owing = result?.balanceOwing ?? 0

  // ---- inline validation hints (client) ----
  const spouseNetMissing = coupled && ret.spouseNetIncome.trim() === ''
  const filerSinInvalid = filerSin !== '' && !isValidSinClient(filerSin)
  const spouseSinInvalid = spouseSin !== '' && !isValidSinClient(spouseSin)

  if (loading) {
    return <div className="text-sm text-[#8595A8]">Loading…</div>
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6 items-start">
      <div className="space-y-4 max-w-3xl">
        {!provinceSupported ? (
          <div className="rounded-lg border border-[#F3C2C2] bg-[#FFF1F1] p-4 text-sm text-[#9B2C2C]">
            Province {ret.province} is not supported in v1 (Quebec files a separate provincial return). Switch the
            filer&apos;s province of residence to a supported one.
          </div>
        ) : null}

        {pullIssues.filter((i) => i.level === 'error').length > 0 ? (
          <div className="rounded-lg border border-[#F3C2C2] bg-[#FFF1F1] p-4 text-sm text-[#9B2C2C]">
            <div className="font-medium mb-1">Slip pull issues</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {pullIssues
                .filter((i) => i.level === 'error')
                .map((i, idx) => (
                  <li key={idx}>{i.message}</li>
                ))}
            </ul>
          </div>
        ) : null}

        {/* ---- Identity ---- */}
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-4">
          <div className="text-[#001B40] font-medium">Identity</div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#001B40] mb-1">Filer</label>
              <div className="text-sm text-[#001B40] py-2">{filer.name}</div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#001B40] mb-1">SIN</label>
              {filer.hasSin && filerSin === '' ? (
                <div className="text-sm text-[#256A3A] py-2">{filer.sinMasked} (on file)</div>
              ) : (
                <SinBnInput
                  kind="individual"
                  sinValue={filerSin}
                  bnValue=""
                  sinOnFileLast3={filer.sinMasked ? filer.sinMasked.slice(-3) : null}
                  onSinChange={setFilerSin}
                  onBnChange={() => {}}
                />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#001B40] mb-1">Date of birth</label>
              <input className={input} type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              <p className="text-xs text-[#8595A8] mt-1">
                Needed for the identification jacket. The age amount is $0 for a working-age filer.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-[#001B40] mb-1">Province of residence (Dec 31)</label>
              <select
                className={input}
                value={ret.province}
                onChange={(e) => setRet((r) => ({ ...r, province: e.target.value }))}
              >
                {['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'SK', 'YT', 'QC'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#576981]">
            <input
              type="checkbox"
              checked={provinceConfirmed}
              onChange={(e) => setProvinceConfirmed(e.target.checked)}
            />
            I lived in {ret.province} on December 31, {taxYear}.
          </label>

          <div>
            <label className="block text-sm font-medium text-[#001B40] mb-1">Marital status</label>
            <div className="flex flex-wrap gap-2">
              {MARITAL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRet((r) => ({ ...r, maritalStatus: o.value }))}
                  className={`px-3 py-1.5 rounded-md border text-sm ${
                    ret.maritalStatus === o.value
                      ? 'border-[#0075DD] bg-[#EAF3FE] text-[#0063BD]'
                      : 'border-[#D9E1EC] text-[#576981] hover:border-[#B9C6D8]'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {coupled ? (
            <div className="rounded-lg border border-[#D9E1EC] bg-[#FBFCFE] p-4 space-y-3">
              <div className="text-sm font-medium text-[#001B40]">Spouse details</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#001B40] mb-1">Spouse first name</label>
                  <input
                    className={input}
                    value={ret.spouseFirstName}
                    onChange={(e) => setRet((r) => ({ ...r, spouseFirstName: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#001B40] mb-1">
                    Spouse net income (her line 23600)
                  </label>
                  <input
                    className={input}
                    inputMode="decimal"
                    value={ret.spouseNetIncome}
                    onChange={(e) => setRet((r) => ({ ...r, spouseNetIncome: e.target.value }))}
                    placeholder="0.00"
                  />
                  {spouseNetMissing ? (
                    <p className="text-xs text-[#9B2C2C] mt-1">Required to prepare a married/common-law return.</p>
                  ) : null}
                </div>
              </div>
              {ret.hasSpouseSin && spouseSin === '' ? (
                <div className="text-sm text-[#256A3A]">Spouse SIN is encrypted on file. Enter a new one to replace it.</div>
              ) : (
                <SinBnInput
                  kind="individual"
                  sinValue={spouseSin}
                  bnValue=""
                  onSinChange={setSpouseSin}
                  onBnChange={() => {}}
                />
              )}
              <p className="text-xs text-[#8595A8]">
                Certified software needs the spouse first name + SIN to NETFILE a married return.
              </p>
            </div>
          ) : null}

          {filerSinInvalid || spouseSinInvalid ? (
            <p className="text-xs text-[#9B2C2C]">A SIN entered above fails the checksum.</p>
          ) : null}
        </div>

        {/* ---- Income ---- */}
        <ReturnFormBuilder
          title="Income"
          subtitle="Dividend lines are auto-pulled from your T5 (and T3, if any). Grossed-up amounts."
          descriptors={descriptorsForSection('income')}
          computed={computedLines}
          overrides={overrides}
          pulledRefs={pulledRefs}
          driftLines={driftLines}
          onOverrideChange={setOverride}
          optInLabel="I have non-registered investment income (capital gains / T3 / other)"
          subtotal={result?.totalIncome}
        />

        {/* ---- Deductions ---- */}
        <ReturnFormBuilder
          title="Deductions"
          subtitle="RRSP = a single number from your latest NOA's deduction limit."
          descriptors={descriptorsForSection('deductions')}
          computed={computedLines}
          overrides={overrides}
          onOverrideChange={setOverride}
          optInLabel="I have other deductions"
          subtotal={result?.netIncome}
        />

        {/* ---- Taxable income ---- */}
        <ReturnFormBuilder
          title="Taxable income"
          descriptors={descriptorsForSection('taxableIncome')}
          computed={computedLines}
          overrides={overrides}
          onOverrideChange={setOverride}
          subtotal={result?.taxableIncome}
        />

        {/* ---- Federal tax ---- */}
        <ReturnFormBuilder
          title="Federal tax & credits"
          subtitle="BPA phase-out, spouse amount, and the dividend tax credit (boxes 12 + 26)."
          descriptors={descriptorsForSection('federalTax')}
          computed={computedLines}
          overrides={overrides}
          onOverrideChange={setOverride}
          optInLabel="I made charitable donations"
          subtotal={result?.federal.netTax}
        />

        {/* ---- Alberta (AB428) ---- */}
        <ReturnFormBuilder
          title="Alberta (AB428)"
          subtitle="AB BPA $22,323 (no phase-out); AB dividend tax credit recomputed at AB rates."
          descriptors={descriptorsForSection('provincialTax')}
          computed={computedLines}
          overrides={overrides}
          onOverrideChange={setOverride}
          optInLabel="I made charitable donations (Alberta)"
          subtotal={result?.provincial.netTax}
        />

        {/* ---- Summary / Review ---- */}
        <ReturnFormBuilder
          title="Review &amp; summary"
          subtitle="Instalments default to $0 — prior-year arrangement payments do NOT go on line 47600."
          descriptors={descriptorsForSection('summary')}
          computed={computedLines}
          overrides={overrides}
          onOverrideChange={setOverride}
          subtotal={result?.totalPayable}
        />

        {/* ---- verify report ---- */}
        {report && report.issues.length > 0 ? (
          <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
            <div className="text-[#001B40] font-medium mb-2">
              Verification {report.ok ? 'passed (with notes)' : 'found errors'}
            </div>
            <ul className="space-y-1 text-sm">
              {report.issues.map((i, idx) => (
                <li
                  key={idx}
                  className={i.level === 'error' ? 'text-[#9B2C2C]' : 'text-[#8A6D1B]'}
                >
                  {i.level === 'error' ? '✗' : '⚠'} {i.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <div className="rounded border border-[#F3C2C2] bg-[#FFF1F1] px-3 py-2 text-sm text-[#9B2C2C]">{error}</div>
        ) : null}
      </div>

      {/* ---- pinned summary rail ---- */}
      <div className="lg:sticky lg:top-4 space-y-3">
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide">Summary</div>
          <Row label="Federal tax (42000)" value={fedTax} />
          <Row label="Alberta tax (42800)" value={abTax} />
          <Row label="Dividend tax credits" value={credits} muted />
          <Row label="Instalments (47600)" value={instalments} muted />
          <div className="border-t border-[#F1F4F8] pt-2">
            {owing > 0 ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#001B40]">Balance owing</span>
                <span className="text-base font-mono font-medium text-[#9B2C2C]">{money2(owing)}</span>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#001B40]">Refund</span>
                <span className="text-base font-mono font-medium text-[#256A3A]">{money2(refund)}</span>
              </div>
            )}
          </div>
          {owing > 3000 && instalments === 0 ? (
            <p className="text-xs text-[#8A6D1B]">
              Owing over $3,000 with no instalments — CRA may charge instalment interest NEXT year. This is not a
              prompt to back-fill line 47600.
            </p>
          ) : null}
        </div>

        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <button
            onClick={() => save()}
            disabled={saving}
            className="w-full px-4 py-2 rounded-md border border-[#D9E1EC] text-sm font-medium text-[#0075DD] hover:bg-[#F4F7FB] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button
            onClick={recompute}
            disabled={busy !== null}
            className="w-full px-4 py-2 rounded-md border border-[#D9E1EC] text-sm font-medium text-[#576981] hover:bg-[#F4F7FB] disabled:opacity-50"
          >
            {busy === 'recompute' ? 'Recomputing…' : 'Recompute (re-pull slips)'}
          </button>
          <button
            onClick={prepare}
            disabled={busy !== null || !provinceSupported}
            className="w-full px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD] disabled:opacity-50"
          >
            {busy === 'prepare' ? 'Verifying…' : 'Prepare & verify'}
          </button>
        </div>

        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide">Export (provisional)</div>
          <p className="text-xs text-[#8595A8]">
            The per-slip transcription sheet you re-key into certified software. Stamped DRAFT until verified.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => downloadExport('csv')}
              className="flex-1 px-3 py-1.5 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB]"
            >
              CSV
            </button>
            <button
              onClick={() => downloadExport('txt')}
              className="flex-1 px-3 py-1.5 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB]"
            >
              Text
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${muted ? 'text-[#8595A8]' : 'text-[#576981]'}`}>{label}</span>
      <span className={`text-sm font-mono ${muted ? 'text-[#8595A8]' : 'text-[#001B40]'}`}>{money2(value)}</span>
    </div>
  )
}
