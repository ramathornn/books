'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { money2 } from '@/lib/tax/round'
import type { T1Result, ValidationReport } from '@/lib/tax/t1/types'

/**
 * Read-only prepared-return surface. Renders the frozen result snapshot and the
 * "Prepare & verify" exit: download the per-slip transcription sheet (regenerated
 * in memory, SIN-bearing, never persisted) or reopen the return to a draft. When
 * the engine/rate table changed since prepare, reopen flags a forced re-prepare.
 */
export default function T1ViewClient({
  taxYear,
  partyId,
  province,
  result,
  report,
  checksum,
  engineVersion,
}: {
  taxYear: number
  partyId: string
  province: string
  result: T1Result | null
  report: ValidationReport | null
  checksum: string | null
  engineVersion: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reopen() {
    if (!window.confirm('Reopen this prepared return to a draft? You will need to re-prepare it before downloading.')) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/t1/${taxYear}/prepare`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partyId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to reopen')
        return
      }
      router.push(`/tax/t1/${taxYear}?partyId=${partyId}`)
    } finally {
      setBusy(false)
    }
  }

  function download(format: 'csv' | 'txt') {
    window.open(`/api/tax/t1/${taxYear}/export?partyId=${partyId}&format=${format}`, '_blank')
  }

  const owing = result?.balanceOwing ?? 0
  const refund = result?.refund ?? 0

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6 items-start max-w-4xl">
      <div className="space-y-4">
        {/* headline */}
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-5">
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide mb-3">Result</div>
          {result ? (
            <div className="grid grid-cols-2 gap-y-2 text-sm">
              <Cell label="Total income (15000)" value={result.totalIncome} />
              <Cell label="Net income (23600)" value={result.netIncome} />
              <Cell label="Taxable income (26000)" value={result.taxableIncome} />
              <Cell label="Federal tax (42000)" value={result.federal.netTax} />
              <Cell label="Alberta tax (42800)" value={result.provincial.netTax} />
              <Cell label="Total payable (43500)" value={result.totalPayable} />
            </div>
          ) : (
            <p className="text-sm text-[#8595A8]">No frozen result snapshot.</p>
          )}
          <div className="border-t border-[#F1F4F8] mt-4 pt-3 flex items-center justify-between">
            <span className="text-sm font-medium text-[#001B40]">{owing > 0 ? 'Balance owing' : 'Refund'}</span>
            <span className={`text-lg font-mono font-medium ${owing > 0 ? 'text-[#9B2C2C]' : 'text-[#256A3A]'}`}>
              {money2(owing > 0 ? owing : refund)}
            </span>
          </div>
        </div>

        {/* federal / AB credit detail */}
        {result ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Jurisdiction title="Federal" j={result.federal} />
            <Jurisdiction title="Alberta (AB428)" j={result.provincial} />
          </div>
        ) : null}

        {/* verify report */}
        {report ? (
          <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
            <div className="text-[#001B40] font-medium mb-2">
              Verification {report.ok ? 'passed' : 'had errors'}
              <span className="text-xs text-[#8595A8] ml-2">
                {new Date(report.checkedAt).toISOString().slice(0, 10)}
              </span>
            </div>
            {report.issues.length === 0 ? (
              <p className="text-sm text-[#256A3A]">No issues.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.issues.map((i, idx) => (
                  <li key={idx} className={i.level === 'error' ? 'text-[#9B2C2C]' : 'text-[#8A6D1B]'}>
                    {i.level === 'error' ? '✗' : '⚠'} {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="rounded border border-[#F3C2C2] bg-[#FFF1F1] px-3 py-2 text-sm text-[#9B2C2C]">{error}</div>
        ) : null}
      </div>

      {/* actions rail */}
      <div className="lg:sticky lg:top-4 space-y-3">
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-4 space-y-2">
          <div className="text-xs font-medium text-[#576981] uppercase tracking-wide">Re-key into certified software</div>
          <p className="text-xs text-[#8595A8]">
            This app cannot NETFILE. Download the per-slip transcription sheet and enter the boxes into Wealthsimple
            / TurboTax / UFile, or mail it.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => download('csv')}
              className="flex-1 px-3 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD]"
            >
              CSV
            </button>
            <button
              onClick={() => download('txt')}
              className="flex-1 px-3 py-2 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB]"
            >
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
          <p className="text-[11px] text-[#8595A8] break-all">
            Province {province} · {engineVersion}
            {checksum ? ` · ${checksum.slice(0, 12)}…` : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span className="text-[#576981]">{label}</span>
      <span className="text-right font-mono text-[#001B40]">{money2(value)}</span>
    </>
  )
}

function Jurisdiction({
  title,
  j,
}: {
  title: string
  j: T1Result['federal']
}) {
  return (
    <div className="rounded-lg border border-[#E5EAF1] bg-white p-4">
      <div className="text-[#001B40] font-medium mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-y-1 text-sm">
        <span className="text-[#576981]">Gross tax</span>
        <span className="text-right font-mono text-[#001B40]">{money2(j.grossTax)}</span>
        <span className="text-[#576981]">Non-refundable credits</span>
        <span className="text-right font-mono text-[#001B40]">{money2(j.nonRefundableCredits)}</span>
        <span className="text-[#576981]">Spouse amount</span>
        <span className="text-right font-mono text-[#001B40]">{money2(j.spouseAmountCredit)}</span>
        <span className="text-[#576981]">Dividend tax credit</span>
        <span className="text-right font-mono text-[#001B40]">{money2(j.dividendTaxCredit)}</span>
        <span className="text-[#576981] font-medium">Net tax</span>
        <span className="text-right font-mono text-[#001B40] font-medium">{money2(j.netTax)}</span>
      </div>
    </div>
  )
}
