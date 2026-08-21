'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SlipType } from '@/lib/tax/summary'
import { money2 } from '@/lib/tax/round'

interface ValidationIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  slipId?: string
}
interface ValidationReport {
  ok: boolean
  checkedAt: string
  type: string
  taxYear: number
  slipCount: number
  issues: ValidationIssue[]
  xsd: { ran: boolean; passed: boolean; note: string }
  summaryTotals: Record<string, number>
}

interface Props {
  type: SlipType
  taxYear: number
  report: ValidationReport
  checksum: string
  filer: { legalName: string; bnRz: string; address: string }
  totalRecipients: number
  alreadyFiled: { filedAt: string | null; craSubmissionRef: string | null; totalRecipients: number } | null
  lastExport: { id: string; status: string; generatedAt: string; checksum: string } | null
}

export default function FileFilingClient({
  type,
  taxYear,
  report,
  checksum,
  filer,
  totalRecipients,
  alreadyFiled,
  lastExport,
}: Props) {
  const router = useRouter()
  const lower = type.toLowerCase()

  const errors = useMemo(() => report.issues.filter((i) => i.level === 'error'), [report])
  const warnings = useMemo(() => report.issues.filter((i) => i.level === 'warning'), [report])

  const [acknowledge, setAcknowledge] = useState(false)
  const [craRef, setCraRef] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ filingExportId: string; checksum: string } | null>(null)

  const blockedByErrors = errors.length > 0
  const needsAck = warnings.length > 0 && !acknowledge
  const canFile = !blockedByErrors && !needsAck && !submitting

  async function file() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/${lower}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxYear,
          acknowledgeWarnings: acknowledge,
          craSubmissionRef: craRef.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error || 'Filing failed')
        return
      }
      setDone({ filingExportId: data.filingExportId, checksum: data.checksum })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Filing failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          File {type} — {taxYear}
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Validate and stage the {type} information return from the effective slips, then file via CRA
          Internet File Transfer. The slip XML is regenerated on authorized download and is never
          stored with SINs in plaintext.
        </p>
      </div>

      {alreadyFiled ? (
        <div className="rounded-lg border border-[#F0C36D] bg-[#FFF8E8] p-3 mb-4 text-sm text-[#8A6D1B]">
          This year was already filed
          {alreadyFiled.filedAt ? ` on ${alreadyFiled.filedAt.slice(0, 10)}` : ''}
          {alreadyFiled.craSubmissionRef ? ` (ref ${alreadyFiled.craSubmissionRef})` : ''} with{' '}
          {alreadyFiled.totalRecipients} recipient{alreadyFiled.totalRecipients === 1 ? '' : 's'}.
          Re-filing stages an <strong>amended</strong> snapshot and supersedes the prior export.
        </div>
      ) : null}

      {/* Filer + scope */}
      <div className="rounded-lg border border-[#D9E1EC] bg-white p-4 mb-4 text-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[#94A3B8] text-xs uppercase tracking-wide mb-1">Filer</div>
            <div className="font-medium text-[#001B40]">{filer.legalName || '— legal name not set —'}</div>
            <div className="text-[#576981]">{filer.bnRz || '— BN / RZ not set —'}</div>
            <div className="text-[#576981]">{filer.address}</div>
          </div>
          <div>
            <div className="text-[#94A3B8] text-xs uppercase tracking-wide mb-1">Return</div>
            <div className="text-[#001B40]">
              {report.slipCount} slip{report.slipCount === 1 ? '' : 's'} · {totalRecipients} recipient
              {totalRecipients === 1 ? '' : 's'}
            </div>
            <div className="text-[#576981] font-mono text-xs break-all">checksum {checksum.slice(0, 16)}…</div>
          </div>
        </div>
      </div>

      {/* Validation gate */}
      <h2 className="text-lg font-medium text-[#001B40] mb-2">Validation</h2>
      <div className="rounded-lg border border-[#D9E1EC] bg-white p-4 mb-4 text-sm space-y-3">
        {/* XSD gate */}
        <div className="flex items-start gap-2">
          <span
            className={`mt-0.5 inline-block w-2 h-2 rounded-full ${
              report.xsd.ran ? (report.xsd.passed ? 'bg-[#2E9E5B]' : 'bg-[#D14343]') : 'bg-[#C9A227]'
            }`}
          />
          <div>
            <div className="text-[#001B40] font-medium">
              XSD schema {report.xsd.ran ? (report.xsd.passed ? 'passed' : 'failed') : 'skipped'}
            </div>
            <div className="text-[#576981] text-xs">{report.xsd.note}</div>
          </div>
        </div>

        {errors.length === 0 && warnings.length === 0 ? (
          <div className="text-[#256A3A]">All checks passed. Ready to file.</div>
        ) : null}

        {errors.length > 0 ? (
          <div>
            <div className="text-[#9B2C2C] font-medium mb-1">
              {errors.length} error{errors.length === 1 ? '' : 's'} — must be resolved before filing
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[#9B2C2C]">
              {errors.map((i, idx) => (
                <li key={idx}>
                  <span className="font-mono text-xs">{i.code}</span> — {i.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <div>
            <div className="text-[#8A6D1B] font-medium mb-1">
              {warnings.length} warning{warnings.length === 1 ? '' : 's'} — acknowledge to proceed
            </div>
            <ul className="list-disc pl-5 space-y-1 text-[#8A6D1B]">
              {warnings.map((i, idx) => (
                <li key={idx}>
                  <span className="font-mono text-xs">{i.code}</span> — {i.message}
                </li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-[#8A6D1B]">
              <input
                type="checkbox"
                checked={acknowledge}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              I acknowledge these warnings and want to file anyway.
            </label>
          </div>
        ) : null}
      </div>

      {/* Footed totals */}
      <h2 className="text-lg font-medium text-[#001B40] mb-2">Summary totals</h2>
      <div className="rounded-lg border border-[#D9E1EC] bg-white overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <tbody>
            {Object.entries(report.summaryTotals).map(([k, v]) => (
              <tr key={k} className="border-b border-[#EEF2F7] last:border-0">
                <td className="px-3 py-2 text-[#576981] font-mono">{k}</td>
                <td className="px-3 py-2 text-right font-mono text-[#001B40]">{money2(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Action */}
      {done ? (
        <div className="rounded-lg border border-[#A8D5B5] bg-[#F0FBF3] p-4 text-sm text-[#256A3A]">
          <div className="font-medium">Filing staged.</div>
          <div className="mt-1">
            Export <span className="font-mono">{done.filingExportId.slice(0, 8)}</span> created (checksum{' '}
            <span className="font-mono">{done.checksum.slice(0, 16)}…</span>). The summary worksheet and
            labelled XML are in Files → Tax Slips/{taxYear}. Submit the official return via CRA Internet
            File Transfer.
          </div>
          <button
            onClick={() => router.push(`/tax/${lower}/summary/${taxYear}`)}
            className="mt-3 px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063bd]"
          >
            Back to summary
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-[#D9E1EC] bg-white p-4">
          <div className="mb-3">
            <label className="block text-xs uppercase tracking-wide text-[#94A3B8] mb-1">
              CRA submission reference (optional)
            </label>
            <input
              type="text"
              value={craRef}
              onChange={(e) => setCraRef(e.target.value)}
              placeholder="Confirmation number from CRA Internet File Transfer"
              className="w-full sm:w-96 px-3 py-2 rounded-md border border-[#D9E1EC] text-sm"
            />
          </div>
          {error ? <div className="mb-3 text-sm text-[#9B2C2C]">{error}</div> : null}
          <button
            onClick={file}
            disabled={!canFile}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white ${
              canFile ? 'bg-[#0075DD] hover:bg-[#0063bd]' : 'bg-[#A9C7E8] cursor-not-allowed'
            }`}
          >
            {submitting ? 'Filing…' : `Stage & file ${type} ${taxYear}`}
          </button>
          {blockedByErrors ? (
            <span className="ml-3 text-xs text-[#9B2C2C]">Resolve the errors above to enable filing.</span>
          ) : needsAck ? (
            <span className="ml-3 text-xs text-[#8A6D1B]">Acknowledge the warnings to enable filing.</span>
          ) : null}
        </div>
      )}

      {lastExport ? (
        <p className="mt-4 text-xs text-[#94A3B8]">
          Last export {lastExport.id.slice(0, 8)} · {lastExport.status} ·{' '}
          {lastExport.generatedAt.slice(0, 10)} · checksum {lastExport.checksum.slice(0, 12)}…
        </p>
      ) : null}
    </div>
  )
}
