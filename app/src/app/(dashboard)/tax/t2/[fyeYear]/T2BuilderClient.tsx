'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { money2, round2, roundDollar } from '@/lib/tax/round'
import { computeT2Federal } from '@/lib/tax/t2/computeT2Federal'
import { computeAt1 } from '@/lib/tax/t2/computeAt1'
import { clientFederalRates, clientAlbertaRates, CLIENT_ENGINE_VERSION } from '@/lib/tax/t2/rates/clientTable'
import type {
  At1Result,
  DividendsPaid,
  GifiResult,
  ScheduleEightResult,
  T2FederalResult,
  T2Lines,
  ValidationIssue,
} from '@/lib/tax/t2/types'
import GifiMapPreflight, { type GifiMapAccount } from './GifiMapPreflight'

interface PulledData {
  lines: T2Lines
  dividendsPaid: DividendsPaid
  gifi: GifiResult
  scheduleEight: ScheduleEightResult
  issues: ValidationIssue[]
}

/**
 * The T2 draft builder. Guided default path: the GIFI-map pre-flight (map every
 * unmapped account, classify passive accounts) → Schedule 1 review → the live
 * federal Part I + Alberta tax rail (recomputed client-side via the pure engines
 * on every change). Save persists draft overrides + S141; Recompute re-pulls the
 * books; Prepare runs the verify gate and freezes the return.
 */
export default function T2BuilderClient({ fyeYear }: { fyeYear: number }) {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [company, setCompany] = useState<{
    legalName: string
    bnRc: string
    albertaCan: string
    province: string
    dividendsDeclaredAccountConfigured: boolean
  } | null>(null)
  const [provinceSupported, setProvinceSupported] = useState(true)
  const [pulled, setPulled] = useState<PulledData | null>(null)
  const [pullIssues, setPullIssues] = useState<ValidationIssue[]>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [isPsb, setIsPsb] = useState(false)
  const [report, setReport] = useState<{ ok: boolean; issues: ValidationIssue[] } | null>(null)

  // GIFI pre-flight accounts.
  const [accounts, setAccounts] = useState<GifiMapAccount[]>([])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [retRes, mapRes] = await Promise.all([
        fetch(`/api/tax/t2/${fyeYear}`),
        fetch(`/api/tax/t2/gifi-map`),
      ])
      const data = await retRes.json()
      if (!retRes.ok) {
        setError(data.error || 'Failed to load return')
        return
      }
      setCompany(data.company)
      setProvinceSupported(!!data.provinceSupported)
      setPulled(data.pulled as PulledData)
      setPullIssues((data.pulled?.issues ?? []) as ValidationIssue[])
      const savedOverride = (data.return?.linesOverride ?? {}) as Record<string, number>
      const ovStrings: Record<string, string> = {}
      for (const [k, v] of Object.entries(savedOverride)) ovStrings[k] = String(v)
      setOverrides(ovStrings)

      if (mapRes.ok) {
        const mapData = await mapRes.json()
        setAccounts((mapData.accounts ?? []) as GifiMapAccount[])
      }
    } finally {
      setLoading(false)
    }
  }, [fyeYear])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ---- Schedule 1 book-to-tax bridge (mirrors buildT2) ----
  const bridge = useMemo(() => {
    const g = pulled?.gifi
    const s8 = pulled?.scheduleEight
    const taxProvision = roundDollar(g?.lines?.['9990']?.amount ?? 0)
    const bookAmortization = roundDollar(g?.lines?.['8670']?.amount ?? 0)
    const mealsTotal = roundDollar(g?.lines?.['8523']?.amount ?? 0)
    const mealsAddBack = roundDollar(mealsTotal * 0.5)
    const bookNetIncome = roundDollar(g?.netIncome9999 ?? 0)
    const recapture = roundDollar(s8?.totalRecapture ?? 0)
    const cca = roundDollar(s8?.totalCcaClaimed ?? 0)
    const terminalLoss = roundDollar(s8?.totalTerminalLoss ?? 0)
    const additions = roundDollar(taxProvision + bookAmortization + mealsAddBack + recapture)
    const deductions = roundDollar(cca + terminalLoss)
    const netIncomeForTax = round2(bookNetIncome + additions - deductions)
    return {
      taxProvision,
      bookAmortization,
      mealsTotal,
      mealsAddBack,
      bookNetIncome,
      recapture,
      cca,
      terminalLoss,
      additions,
      deductions,
      netIncomeForTax,
    }
  }, [pulled])

  // ---- live client-side compute (federal Part I + Alberta tax) ----
  const computed = useMemo<{ federal: T2FederalResult; alberta: At1Result } | null>(() => {
    if (!pulled) return null
    try {
      const fedRates = clientFederalRates(fyeYear)
      const abRates = clientAlbertaRates(fyeYear)
      // ABI ≈ active income from the pull; for the active-only persona AII = 0.
      const abi = Math.max(0, round2(bridge.netIncomeForTax))
      const federalInput = {
        taxationYear: fyeYear,
        taxableIncome: bridge.netIncomeForTax,
        activeBusinessIncome: abi,
        aggregateInvestmentIncome: 0,
        priorYearAaii: 0,
        taxableCapital: 0,
        portfolioDividendsReceived: 0,
        eligiblePortfolioDividends: 0,
        nonEligiblePortfolioDividends: 0,
        eligibleDividendsPaid: pulled.dividendsPaid.eligible,
        nonEligibleDividendsPaid: pulled.dividendsPaid.nonEligible,
        openingErdtoh: 0,
        openingNerdtoh: 0,
        openingGrip: 0,
        eligibleDividendsReceived: 0,
        isPersonalServicesBusiness: isPsb,
      }
      const federal = computeT2Federal(federalInput, fedRates, CLIENT_ENGINE_VERSION)
      const alberta = computeAt1(
        {
          taxationYear: fyeYear,
          albertaTaxableIncome: bridge.netIncomeForTax,
          activeBusinessIncome: abi,
          reducedBusinessLimit: federal.businessLimit,
          allocationFactor: 1.0,
          innovationEmploymentGrant: 0,
          isPersonalServicesBusiness: isPsb,
        },
        abRates,
        CLIENT_ENGINE_VERSION,
      )
      return { federal, alberta }
    } catch {
      return null
    }
  }, [pulled, bridge, fyeYear, isPsb])

  function overridePayload(): T2Lines {
    const out: T2Lines = {}
    for (const [k, v] of Object.entries(overrides)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (Number.isFinite(n)) out[k] = n
    }
    return out
  }

  const save = useCallback(
    async (silent = false): Promise<boolean> => {
      if (!silent) setSaving(true)
      setError(null)
      try {
        const res = await fetch(`/api/tax/t2/${fyeYear}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ linesOverride: overridePayload() }),
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data.error || 'Failed to save')
          return false
        }
        return true
      } finally {
        if (!silent) setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fyeYear, overrides],
  )

  async function recompute() {
    setBusy('recompute')
    setError(null)
    try {
      await save(true)
      const res = await fetch(`/api/tax/t2/${fyeYear}/recompute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Recompute failed')
        return
      }
      setReport(data.report ?? null)
      await loadAll()
    } finally {
      setBusy(null)
    }
  }

  async function prepare() {
    setBusy('prepare')
    setError(null)
    try {
      const saved = await save(true)
      if (!saved) return
      let res = await fetch(`/api/tax/t2/${fyeYear}/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
        res = await fetch(`/api/tax/t2/${fyeYear}/prepare`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acknowledgeWarnings: true }),
        })
        data = await res.json()
      }
      if (!res.ok) {
        setReport(data.report ?? null)
        setError(data.error || 'Verification failed — resolve the errors below.')
        return
      }
      router.push(`/tax/t2/${fyeYear}/view`)
    } finally {
      setBusy(null)
    }
  }

  function downloadExport(format: 'csv' | 'txt') {
    window.open(`/api/tax/t2/${fyeYear}/export?format=${format}`, '_blank')
  }

  async function applyMapping(updates: Array<{ id: string; gifiCode?: string | null; incomeNature?: string | null; confirm?: boolean }>) {
    const res = await fetch(`/api/tax/t2/gifi-map`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Failed to apply GIFI mapping')
      return data
    }
    await loadAll()
    return data
  }

  if (loading) return <div className="text-sm text-[#8595A8]">Loading…</div>

  const unmapped = accounts.filter((a) => !a.gifiCode).length
  const untaggedPassive = accounts.filter((a) => a.incomeNatureRequired && !a.incomeNature).length
  const fed = computed?.federal
  const ab = computed?.alberta
  const pullErrors = pullIssues.filter((i) => i.level === 'error')

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6 items-start">
      <div className="space-y-4 max-w-3xl">
        {!provinceSupported ? (
          <div className="rounded-lg border border-[#F3C2C2] bg-[#FFF1F1] p-4 text-sm text-[#9B2C2C]">
            Province {company?.province} is not supported in v1. The T2/AT1 module covers Alberta-resident CCPCs only.
          </div>
        ) : null}

        {company && !company.dividendsDeclaredAccountConfigured ? (
          <div className="rounded-lg border border-[#F3D9A8] bg-[#FFF8E8] p-4 text-sm text-[#8A6D1B]">
            The Dividends Declared GL account is not configured. Set it in Settings → Company — it is the single
            source for dividends paid, GIFI 3700, the dividend refund, and GRIP.
          </div>
        ) : null}

        {pullErrors.length > 0 ? (
          <div className="rounded-lg border border-[#F3C2C2] bg-[#FFF1F1] p-4 text-sm text-[#9B2C2C]">
            <div className="font-medium mb-1">Pull issues</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {pullErrors.map((i, idx) => (
                <li key={idx}>{i.message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* ---- 1. GIFI map pre-flight ---- */}
        <GifiMapPreflight
          accounts={accounts}
          unmapped={unmapped}
          untaggedPassive={untaggedPassive}
          onApply={applyMapping}
        />

        {/* ---- 2. GIFI balance sheet / income statement summary ---- */}
        {pulled ? (
          <Section title="GIFI roll-up" subtitle="Schedule 100 (balance sheet) + Schedule 125 (income statement), computed PRE-CLOSE.">
            <Row label="2599 — Total assets" value={pulled.gifi.totalAssets2599} />
            <Row label="3499 — Total liabilities" value={pulled.gifi.totalLiabilities3499} />
            <Row label="3620 — Total shareholder equity" value={pulled.gifi.totalEquity3620} />
            <Row label="3600 — Retained earnings (end)" value={pulled.gifi.retainedEarnings3600} />
            <Row label="9999 — Net income after tax" value={pulled.gifi.netIncome9999} strong />
            {pulled.gifi.roundingPlug !== 0 ? (
              <Row label="Rounding plug → retained earnings" value={pulled.gifi.roundingPlug} muted />
            ) : null}
          </Section>
        ) : null}

        {/* ---- 3. Schedule 1 — book to net income for tax ---- */}
        <Section title="Schedule 1 — net income for tax" subtitle="GIFI 9999 (after tax) + additions − deductions → line 300.">
          <Row label="GIFI 9999 — net income (after tax)" value={bridge.bookNetIncome} />
          <Row label="103 — income-tax provision add-back" value={bridge.taxProvision} />
          <Row label="104 — accounting amortization add-back" value={bridge.bookAmortization} />
          <Row label="295 — non-deductible 50% meals (ITA 67.1)" value={bridge.mealsAddBack} />
          <Row label="107 — recapture of CCA" value={bridge.recapture} />
          <Row label="403 — capital cost allowance (Schedule 8)" value={-bridge.cca} />
          <Row label="404 — terminal loss" value={-bridge.terminalLoss} />
          <Row label="300 — net income for tax" value={bridge.netIncomeForTax} strong />
        </Section>

        {/* ---- 4. Federal tax ---- */}
        {fed ? (
          <Section title="Federal CCPC tax" subtitle="Part I, the small business deduction, ART, RDTOH, dividend refund, GRIP.">
            <Row label="425 — small-business income" value={fed.sbdIncome} />
            <Row label="430 — small business deduction (19%)" value={fed.lines['T2:430'] ?? 0} muted />
            <Row label="550 — full-rate taxable income" value={fed.fullRateTaxableIncome} muted />
            <Row label="604 — additional refundable tax (AII)" value={fed.art} muted />
            <Row label="700 — Part I tax payable" value={fed.partOneTax} strong />
            <Row label="784 — dividend refund" value={fed.dividendRefund} muted />
            <Row label="770 — GRIP, closing" value={fed.closingGrip} muted />
            {fed.gripOverDesignated ? (
              <div className="text-xs text-[#9B2C2C] py-2">
                Eligible dividends paid exceed closing GRIP room — ITA 185.1 Part III.1 penalty risk. Re-designate the
                excess as non-eligible.
              </div>
            ) : null}
          </Section>
        ) : null}

        {/* ---- 5. Alberta AT1 ---- */}
        {ab ? (
          <Section title="Alberta AT1" subtitle="8% general / 2% small business; filed separately to Alberta TRA.">
            <Row label="068 — Alberta taxable income" value={ab.albertaTaxableIncome} />
            <Row label="061 — Alberta small-business income" value={ab.albertaSbdIncome} muted />
            <Row label="070 — Alberta tax before credits" value={ab.taxBeforeCredits} muted />
            <Row label="072 — net Alberta tax payable" value={ab.albertaTaxPayable} strong />
          </Section>
        ) : null}

        {/* ---- PSB toggle (opt-in) ---- */}
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
          <label className="flex items-center gap-2 text-sm text-[#576981]">
            <input type="checkbox" checked={isPsb} onChange={(e) => setIsPsb(e.target.checked)} />
            This corporation is a personal-services business (PSB): no SBD, no general rate reduction, +5% federal tax.
          </label>
        </div>

        {/* ---- verify report ---- */}
        {report && report.issues.length > 0 ? (
          <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
            <div className="text-[#001B40] font-medium mb-2">
              Verification {report.ok ? 'passed (with notes)' : 'found errors'}
            </div>
            <ul className="space-y-1 text-sm">
              {report.issues.map((i, idx) => (
                <li key={idx} className={i.level === 'error' ? 'text-[#9B2C2C]' : 'text-[#8A6D1B]'}>
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
          <RailRow label="Federal Part I (700)" value={fed?.partOneTax ?? 0} />
          <RailRow label="Dividend refund (784)" value={-(fed?.dividendRefund ?? 0)} muted />
          <RailRow label="Alberta tax (072)" value={ab?.albertaTaxPayable ?? 0} />
          <div className="border-t border-[#F1F4F8] pt-2 flex items-center justify-between">
            <span className="text-sm font-medium text-[#001B40]">Total tax</span>
            <span className="text-base font-mono font-medium text-[#001B40]">
              {money2(round2((fed?.partOneTax ?? 0) - (fed?.dividendRefund ?? 0) + (ab?.albertaTaxPayable ?? 0)))}
            </span>
          </div>
          <p className="text-xs text-[#8595A8]">Live preview. The server stamps the authoritative figures on prepare.</p>
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
            {busy === 'recompute' ? 'Recomputing…' : 'Recompute (re-pull books)'}
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
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide">Re-key worksheet (provisional)</div>
          <p className="text-xs text-[#8595A8]">
            The two worksheets (federal T2 + Alberta AT1) you re-key into certified software. Stamped DRAFT until
            verified.
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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-lg border border-[#E5EAF1] bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div>
          <div className="text-[#001B40] font-medium">{title}</div>
          {subtitle ? <div className="text-xs text-[#8595A8] mt-0.5">{subtitle}</div> : null}
        </div>
        <svg className={`w-4 h-4 text-[#8595A8] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open ? <div className="px-4 pb-3">{children}</div> : null}
    </div>
  )
}

function Row({ label, value, strong, muted }: { label: string; value: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#F1F4F8] last:border-0">
      <span className={`text-sm ${muted ? 'text-[#8595A8]' : 'text-[#576981]'}`}>{label}</span>
      <span className={`text-sm font-mono ${strong ? 'text-[#001B40] font-medium' : muted ? 'text-[#8595A8]' : 'text-[#001B40]'}`}>
        {money2(value)}
      </span>
    </div>
  )
}

function RailRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-sm ${muted ? 'text-[#8595A8]' : 'text-[#576981]'}`}>{label}</span>
      <span className={`text-sm font-mono ${muted ? 'text-[#8595A8]' : 'text-[#001B40]'}`}>{money2(value)}</span>
    </div>
  )
}
