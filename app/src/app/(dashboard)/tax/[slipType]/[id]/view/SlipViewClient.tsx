'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { money2 } from '@/lib/tax/round'
import type { SlipType } from '@/lib/tax/descriptors/registry'
import SlipStatusBadge from '../../../_shared/SlipStatusBadge'

interface BoxCol {
  key: string
  officialNumber: string
  label: string
}

interface SlipVM {
  id: string
  taxYear: number
  status: string
  reportCode: string
  slipNumber: string | null
  amendmentSeq: number
  recipientName: string
  recipientIdMasked: string
  recipientAddress: string
  notes: string
  boxes: Record<string, number>
  pulledTotal: number | null
}

interface Props {
  type: SlipType
  slip: SlipVM
  boxes: BoxCol[]
}

/**
 * Single-slip view (T5 / T4A). Shows the recipient + box amounts and the
 * lifecycle actions: issue a draft, download the recipient-copy PDF, amend or
 * cancel an issued/filed slip, or delete a draft. Append-only semantics are
 * enforced server-side (assertSlipMutable); the UI just routes the action.
 */
export default function SlipViewClient({ type, slip, boxes }: Props) {
  const router = useRouter()
  const lower = type.toLowerCase()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDraft = slip.status === 'draft'
  const canAmend = slip.status === 'issued' || slip.status === 'filed'

  async function call(path: string, method = 'POST', body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Action failed')
      return data
    } catch (e) {
      setError((e as Error).message)
      throw e
    } finally {
      setBusy(false)
    }
  }

  async function issue() {
    await call(`/api/tax/${lower}/${slip.id}/issue`).then(() => router.refresh())
  }
  async function amend() {
    const data = await call(`/api/tax/${lower}/${slip.id}/amend`, 'POST', {})
    router.push(`/tax/${lower}/${data.slip.id}/view`)
  }
  async function cancel() {
    if (!confirm('Cancel this slip? A cancellation (report code C) will be issued.')) return
    const data = await call(`/api/tax/${lower}/${slip.id}/cancel`, 'POST', {})
    router.push(`/tax/${lower}/${data.slip.id}/view`)
  }
  async function del() {
    if (!confirm('Delete this draft slip?')) return
    await call(`/api/tax/${lower}/${slip.id}`, 'DELETE').then(() => router.push(`/tax/${lower}?year=${slip.taxYear}`))
  }

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
            {type} slip {slip.slipNumber ?? '(draft)'}
            {slip.amendmentSeq > 0 ? ` · amendment ${slip.amendmentSeq}` : ''}
          </h1>
          <p className="text-sm text-[#576981]">Tax year {slip.taxYear}</p>
        </div>
        <SlipStatusBadge status={slip.status} reportCode={slip.reportCode} />
      </div>

      {error ? (
        <div className="rounded border border-[#F3C2C2] bg-[#FFF1F1] px-3 py-2 text-sm text-[#9B2C2C]">{error}</div>
      ) : null}

      <div className="rounded-lg border border-[#E5EAF1] bg-white p-5">
        <h3 className="text-sm font-medium text-[#001B40] mb-2">Recipient</h3>
        <div className="text-sm text-[#001B40]">{slip.recipientName}</div>
        <div className="text-xs text-[#8595A8]">{slip.recipientIdMasked}</div>
        {slip.recipientAddress ? <div className="text-xs text-[#8595A8] mt-1">{slip.recipientAddress}</div> : null}
      </div>

      <div className="rounded-lg border border-[#E5EAF1] bg-white p-5">
        <h3 className="text-sm font-medium text-[#001B40] mb-3">Amounts</h3>
        <table className="w-full text-sm">
          <tbody>
            {boxes.map((b) => (
              <tr key={b.key} className="border-b border-[#F1F4F8] last:border-0">
                <td className="py-2 text-[#576981]">
                  Box {b.officialNumber} · {b.label}
                </td>
                <td className="py-2 text-right tabular-nums text-[#001B40]">
                  {slip.boxes[b.key] !== undefined ? money2(slip.boxes[b.key]) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {slip.pulledTotal != null ? (
          <p className="mt-3 text-xs text-[#8595A8]">Auto-pulled source total: {money2(slip.pulledTotal)}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {isDraft ? (
          <>
            <button
              onClick={issue}
              disabled={busy}
              className="px-4 py-2 rounded bg-[#0075DD] text-white text-sm hover:bg-[#0063BD] disabled:opacity-40"
            >
              Issue slip
            </button>
            <button
              onClick={del}
              disabled={busy}
              className="px-4 py-2 rounded border border-[#F3C2C2] text-[#9B2C2C] text-sm hover:bg-[#FFF1F1] disabled:opacity-40"
            >
              Delete draft
            </button>
          </>
        ) : null}

        {!isDraft ? (
          <a
            href={`/api/tax/${lower}/${slip.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded border border-[#D9E1EC] text-[#576981] text-sm hover:bg-[#F4F7FB]"
          >
            Recipient copy (PDF)
          </a>
        ) : null}

        {canAmend ? (
          <>
            <button
              onClick={amend}
              disabled={busy}
              className="px-4 py-2 rounded border border-[#D9E1EC] text-[#576981] text-sm hover:bg-[#F4F7FB] disabled:opacity-40"
            >
              Amend
            </button>
            <button
              onClick={cancel}
              disabled={busy}
              className="px-4 py-2 rounded border border-[#F3C2C2] text-[#9B2C2C] text-sm hover:bg-[#FFF1F1] disabled:opacity-40"
            >
              Cancel slip
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
