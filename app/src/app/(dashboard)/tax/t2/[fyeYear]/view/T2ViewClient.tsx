'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { money2 } from '@/lib/tax/round'
import type { T2Result, ValidationReport } from '@/lib/tax/t2/types'

/**
 * Read-only prepared-return surface. Renders the frozen result snapshot (federal
 * Part I + Alberta tax, dividend refund, GRIP closing, verify report) and the
 * "prepare & verify" exit: download the two-worksheet re-key sheet (regenerated
 * in memory, never persisted) or reopen the return to a draft. When the
 * engine/rate table changed since prepare, reopen flags a forced re-prepare.
 */
export default function T2ViewClient({
  fyeYear,
  result,
  report,
  checksum,
  engineVersion,
}: {
  fyeYear: number
  result: T2Result | null
  report: ValidationReport | null
  checksum: string | null
  engineVersion: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reopen() {
    if (!window.confirm('Reopen this prepared return to a draft? You will need to re-prepare it before downloading.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/t2/${fyeYear}/prepare`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to reopen')
        return
      }
      router.push(`/tax/t2/${fyeYear}`)
    } finally {
      setBusy(false)
    }
  }

  function download(format: 'csv' | 'txt') {
    window.open(`/api/tax/t2/${fyeYear}/export?format=${format}`, '_blank')
  }

  if (!result) {
    return <div className="text-sm text-[#8595A8]">No frozen result snapshot for this return.</div>
  }

  const fed = result.federal
  const ab = result.alberta
  const totalTax = money2(fed.partOneTax - fed.dividendRefund + ab.albertaTaxPayable)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6 items-start max-w-4xl">
      <div className="space-y-4">
        <Card title="Federal T2">
          <Row label="300 — net income for tax" value={fed.taxableIncome} />
          <Row label="425 — small-business income" value={fed.sbdIncome} />
          <Row label="550 — full-rate taxable income" value={fed.fullRateTaxableIncome} muted />
          <Row label="604 — additional refundable tax (AII)" value={fed.art} muted />
          <Row label="700 — Part I tax payable" value={fed.partOneTax} strong />
          <Row label="784 — dividend refund" value={fed.dividendRefund} muted />
          <Row label="530 — eligible RDTOH, closing" value={fed.closingErdtoh} muted />
          <Row label="545 — non-eligible RDTOH, closing" value={fed.closingNerdtoh} muted />
          <Row label="770 — GRIP, closing" value={fed.closingGrip} muted />
        </Card>

        <Card title="Alberta AT1">
          <Row label="068 — Alberta taxable income" value={ab.albertaTaxableIncome} />
          <Row label="061 — Alberta small-business income" value={ab.albertaSbdIncome} muted />
          <Row label="070 — Alberta tax before credits" value={ab.taxBeforeCredits} muted />
          <Row label="129 — Innovation Employment Grant" value={ab.innovationEmploymentGrant} muted />
          <Row label="072 — net Alberta tax payable" value={ab.albertaTaxPayable} strong />
        </Card>

        <Card title="GIFI">
          <Row label="2599 — total assets" value={result.gifi.totalAssets2599} />
          <Row label="3499 — total liabilities" value={result.gifi.totalLiabilities3499} />
          <Row label="3620 — total equity" value={result.gifi.totalEquity3620} />
          <Row label="9999 — net income after tax" value={result.gifi.netIncome9999} strong />
        </Card>

        {report && report.issues.length > 0 ? (
          <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
            <div className="text-[#001B40] font-medium mb-2">Verification {report.ok ? 'passed' : 'errors'}</div>
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

      <div className="lg:sticky lg:top-4 space-y-3">
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide">Total tax</div>
          <div className="text-2xl font-mono font-medium text-[#001B40]">{totalTax}</div>
          <p className="text-xs text-[#8595A8]">Federal Part I − dividend refund + Alberta tax.</p>
        </div>

        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide">Re-key worksheet</div>
          <p className="text-xs text-[#8595A8]">
            Two worksheets: federal T2 (CRA-certified software) + Alberta AT1 (TRA Net File). Re-key — the app cannot
            transmit.
          </p>
          <div className="flex gap-2">
            <button onClick={() => download('csv')} className="flex-1 px-3 py-1.5 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB]">
              CSV
            </button>
            <button onClick={() => download('txt')} className="flex-1 px-3 py-1.5 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB]">
              Text
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <button
            onClick={reopen}
            disabled={busy}
            className="w-full px-4 py-2 rounded-md border border-[#D9E1EC] text-sm font-medium text-[#576981] hover:bg-[#F4F7FB] disabled:opacity-50"
          >
            {busy ? 'Reopening…' : 'Reopen to draft'}
          </button>
          {checksum ? (
            <p className="text-[10px] text-[#8595A8] font-mono break-all">
              {engineVersion}
              <br />
              sha256 {checksum.slice(0, 16)}…
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
      <div className="text-[#001B40] font-medium mb-2">{title}</div>
      {children}
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
