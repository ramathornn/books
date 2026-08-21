'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { money2 } from '@/lib/tax/round'
import type { SlipType } from '@/lib/tax/descriptors/registry'

interface BoxCol {
  key: string
  officialNumber: string
  label: string
}

interface Recipient {
  id: string
  name: string
  idMasked: string
  vendorLinked: boolean
  isContractor: boolean
}

interface Props {
  type: SlipType
  taxYear: number
  recipients: Recipient[]
  boxes: BoxCol[]
}

/**
 * New-slip flow (T5 / T4A): pick a recipient → auto-pull the box amounts from
 * the GL / contractor expenses → review → create the draft. For T4A the auto-
 * pull is Box 048 from the recipient's contractor-flagged vendor expenses,
 * scoped to the subcontractor account; a banner warns when the recipient isn't a
 * contractor-flagged vendor (the load-bearing flag — design Phase 4).
 */
export default function NewSlipClient({ type, taxYear, recipients, boxes }: Props) {
  const router = useRouter()
  const lower = type.toLowerCase()

  const [partyId, setPartyId] = useState('')
  const [kind, setKind] = useState<'eligible' | 'nonEligible'>('nonEligible')
  const [pulled, setPulled] = useState<Record<string, number> | null>(null)
  const [sourceRef, setSourceRef] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recipient = recipients.find((r) => r.id === partyId) || null
  const t4aContractorWarning = type === 'T4A' && recipient && !(recipient.vendorLinked && recipient.isContractor)

  async function autoPull() {
    if (!partyId) {
      setError('Select a recipient first.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/${lower}/compute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear, partyId, kind }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Auto-pull failed')
      setPulled(data.boxes || {})
      setSourceRef(data.sourceRef ?? null)
    } catch (e) {
      setError((e as Error).message)
      setPulled(null)
    } finally {
      setBusy(false)
    }
  }

  async function createDraft(thenIssue: boolean) {
    if (!partyId || !pulled) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tax/${lower}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxYear, partyId, boxes: pulled, sourceRef }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not create slip')
      const slipId = data.slip.id

      if (thenIssue) {
        const iss = await fetch(`/api/tax/${lower}/${slipId}/issue`, { method: 'POST' })
        const issData = await iss.json()
        if (!iss.ok) throw new Error(issData.error || 'Could not issue slip')
      }
      router.push(`/tax/${lower}/${slipId}/view`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-5">
      {error ? (
        <div className="rounded border border-[#F3C2C2] bg-[#FFF1F1] px-3 py-2 text-sm text-[#9B2C2C]">{error}</div>
      ) : null}

      <div className="rounded-lg border border-[#E5EAF1] bg-white p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">Recipient</label>
          <select
            value={partyId}
            onChange={(e) => {
              setPartyId(e.target.value)
              setPulled(null)
            }}
            className="w-full rounded border border-[#D9E1EC] px-3 py-2 text-sm"
          >
            <option value="">Select a recipient…</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.idMasked})
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[#8595A8]">
            Recipients are managed under Tax → Recipients.
          </p>
        </div>

        {type === 'T5' ? (
          <div>
            <label className="block text-sm font-medium text-[#001B40] mb-1">Dividend type</label>
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as 'eligible' | 'nonEligible')
                setPulled(null)
              }}
              className="w-full rounded border border-[#D9E1EC] px-3 py-2 text-sm"
            >
              <option value="nonEligible">Non-eligible (other than eligible)</option>
              <option value="eligible">Eligible</option>
            </select>
          </div>
        ) : null}

        {t4aContractorWarning ? (
          <div className="rounded border border-[#F3D9A8] bg-[#FFF8E8] px-3 py-2 text-xs text-[#8A6D1B]">
            This recipient is not linked to a contractor-flagged vendor. T4A Box 048 auto-pulls from a vendor flagged
            <span className="font-medium"> isContractor</span>; the pull will return $0 until the recipient is linked.
          </div>
        ) : null}

        <button
          onClick={autoPull}
          disabled={busy || !partyId}
          className="px-4 py-2 rounded border border-[#0075DD] text-[#0075DD] text-sm hover:bg-[#EAF3FE] disabled:opacity-40"
        >
          {busy ? 'Pulling…' : 'Auto-pull amounts'}
        </button>
      </div>

      {pulled ? (
        <div className="rounded-lg border border-[#E5EAF1] bg-white p-5">
          <h3 className="text-sm font-medium text-[#001B40] mb-3">Computed amounts</h3>
          <table className="w-full text-sm">
            <tbody>
              {boxes.map((b) => (
                <tr key={b.key} className="border-b border-[#F1F4F8] last:border-0">
                  <td className="py-2 text-[#576981]">
                    Box {b.officialNumber} · {b.label}
                  </td>
                  <td className="py-2 text-right tabular-nums text-[#001B40]">
                    {pulled[b.key] !== undefined ? money2(pulled[b.key]) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => createDraft(false)}
              disabled={busy}
              className="px-4 py-2 rounded border border-[#D9E1EC] text-[#576981] text-sm hover:bg-[#F4F7FB] disabled:opacity-40"
            >
              Save draft
            </button>
            <button
              onClick={() => createDraft(true)}
              disabled={busy}
              className="px-4 py-2 rounded bg-[#0075DD] text-white text-sm hover:bg-[#0063BD] disabled:opacity-40"
            >
              Save &amp; issue
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
