'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import SinBnInput from '../_shared/SinBnInput'
import RecipientAddressFields, { type AddressValue } from '../_shared/RecipientAddressFields'

export interface RecipientVM {
  id: string
  kind: 'individual' | 'business'
  firstName: string
  lastName: string
  businessName: string
  sinLast3: string | null
  businessNumber: string | null
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
  vendorLinked: boolean
  isContractor: boolean
}

function displayName(r: RecipientVM): string {
  return r.kind === 'business'
    ? r.businessName || '(unnamed business)'
    : [r.firstName, r.lastName].filter(Boolean).join(' ') || '(unnamed)'
}
function maskedId(r: RecipientVM): string {
  return r.sinLast3 ? `•••-••-${r.sinLast3}` : r.businessNumber || '—'
}

const emptyAddress: AddressValue = {
  addressLine1: '', addressLine2: '', city: '', province: '', postalCode: '', country: 'CA',
}

/**
 * Recipient directory + inline create form. Reuses the shared SinBnInput and
 * RecipientAddressFields (the same components the slip form-builder uses). New
 * SINs are POSTed raw and encrypted server-side; the cipher never returns.
 */
export default function RecipientsClient({ initial }: { initial: RecipientVM[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [kind, setKind] = useState<'individual' | 'business'>('individual')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [sin, setSin] = useState('')
  const [bn, setBn] = useState('')
  const [address, setAddress] = useState<AddressValue>(emptyAddress)

  const input =
    'w-full rounded-md border border-[#D9E1EC] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30'

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tax/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, firstName, lastName, businessName, sin, businessNumber: bn, ...address }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create recipient')
        return
      }
      setAdding(false)
      setFirstName(''); setLastName(''); setBusinessName(''); setSin(''); setBn(''); setAddress(emptyAddress)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#576981]">
          {initial.length} {initial.length === 1 ? 'recipient' : 'recipients'}
        </span>
        {!adding ? (
          <button
            onClick={() => setAdding(true)}
            className="px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD]"
          >
            + New recipient
          </button>
        ) : null}
      </div>

      {adding ? (
        <div className="max-w-2xl rounded-lg border border-[#D9E1EC] bg-[#FBFCFE] p-5 space-y-3">
          <div className="flex gap-2 text-sm">
            {(['individual', 'business'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-1.5 rounded-md border ${
                  kind === k ? 'border-[#0075DD] bg-[#EAF3FE] text-[#0063BD]' : 'border-[#D9E1EC] text-[#576981]'
                }`}
              >
                {k === 'individual' ? 'Individual' : 'Business'}
              </button>
            ))}
          </div>

          {kind === 'individual' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[#001B40] mb-1">First name</label>
                <input className={input} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#001B40] mb-1">Last name</label>
                <input className={input} value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[#001B40] mb-1">Business name</label>
              <input className={input} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
            </div>
          )}

          <SinBnInput kind={kind} sinValue={sin} bnValue={bn} onSinChange={setSin} onBnChange={setBn} />
          <RecipientAddressFields value={address} onChange={(patch) => setAddress((a) => ({ ...a, ...patch }))} />

          {error ? <p className="text-sm text-[#9B2C2C]">{error}</p> : null}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save recipient'}
            </button>
            <button
              onClick={() => {
                setAdding(false)
                setError(null)
              }}
              className="px-4 py-2 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-[#E5EAF1] bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E5EAF1] text-left text-[#576981]">
              <th className="px-4 py-2 font-medium">Recipient</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">SIN / BN</th>
              <th className="px-4 py-2 font-medium">Vendor link</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[#576981]">
                  No recipients yet. Click <span className="font-medium text-[#001B40]">+ New recipient</span> to add a
                  person or business to get started.
                </td>
              </tr>
            ) : (
              initial.map((r) => (
                <tr key={r.id} className="border-b border-[#F1F4F8] last:border-0">
                  <td className="px-4 py-2 text-[#001B40]">{displayName(r)}</td>
                  <td className="px-4 py-2 text-[#576981] capitalize">{r.kind}</td>
                  <td className="px-4 py-2 font-mono text-[#001B40]">{maskedId(r)}</td>
                  <td className="px-4 py-2 text-xs text-[#576981]">
                    {r.vendorLinked ? (
                      <span>
                        Vendor
                        {r.isContractor ? (
                          <span className="ml-1 rounded bg-[#EAF3FE] text-[#0063BD] px-1.5 py-0.5">contractor</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[#8595A8]">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
