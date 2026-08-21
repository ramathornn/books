'use client'

import { useEffect, useState } from 'react'

import SinBnInput from './SinBnInput'
import RecipientAddressFields, { type AddressValue } from './RecipientAddressFields'

/**
 * Recipient (TaxParty) picker, shared by the slip form-builder. Lists existing
 * recipients from /api/tax/parties and lets the user add a new one inline (with
 * SIN/BN + address validation). On selection it bubbles up the chosen partyId.
 *
 * The masked SIN/BN never leaves the server in the clear; this only ever sees
 * `sinLast3` for display. New SINs are sent raw on create and encrypted server-
 * side.
 */

export interface PartyOption {
  id: string
  kind: string
  firstName: string
  lastName: string
  businessName: string
  sinLast3: string | null
  businessNumber: string | null
}

function optionLabel(p: PartyOption): string {
  const name =
    p.kind === 'business'
      ? p.businessName
      : [p.firstName, p.lastName].filter(Boolean).join(' ')
  const id = p.sinLast3 ? `•••${p.sinLast3}` : p.businessNumber || ''
  return id ? `${name || '(unnamed)'} — ${id}` : name || '(unnamed)'
}

const emptyAddress: AddressValue = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  country: 'CA',
}

export default function RecipientPicker({
  value,
  onChange,
  defaultKind = 'individual',
}: {
  value: string | null
  onChange: (partyId: string | null, option: PartyOption | null) => void
  defaultKind?: 'individual' | 'business'
}) {
  const [parties, setParties] = useState<PartyOption[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // New-recipient form state.
  const [kind, setKind] = useState<'individual' | 'business'>(defaultKind)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [sin, setSin] = useState('')
  const [bn, setBn] = useState('')
  const [address, setAddress] = useState<AddressValue>(emptyAddress)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/tax/parties')
      const data = await res.json()
      setParties(data.parties ?? [])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function createParty() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/tax/parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          firstName,
          lastName,
          businessName,
          sin,
          businessNumber: bn,
          ...address,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create recipient')
        return
      }
      const created: PartyOption = data.party
      setParties((prev) => [created, ...prev])
      onChange(created.id, created)
      setAdding(false)
      // reset
      setFirstName(''); setLastName(''); setBusinessName(''); setSin(''); setBn(''); setAddress(emptyAddress)
    } finally {
      setSaving(false)
    }
  }

  const input =
    'w-full rounded-md border border-[#D9E1EC] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30'

  return (
    <div>
      <label className="block text-sm font-medium text-[#001B40] mb-1">Recipient</label>
      {!adding ? (
        <div className="flex items-center gap-2">
          <select
            className={input}
            value={value ?? ''}
            disabled={loading}
            onChange={(e) => {
              const id = e.target.value || null
              onChange(id, parties.find((p) => p.id === id) ?? null)
            }}
          >
            <option value="">{loading ? 'Loading…' : 'Select a recipient'}</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {optionLabel(p)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="shrink-0 px-3 py-2 rounded-md border border-[#D9E1EC] text-sm text-[#0075DD] hover:bg-[#F4F7FB]"
          >
            + New
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-[#D9E1EC] bg-[#FBFCFE] p-4 space-y-3">
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

          <SinBnInput
            kind={kind}
            sinValue={sin}
            bnValue={bn}
            onSinChange={setSin}
            onBnChange={setBn}
          />

          <RecipientAddressFields value={address} onChange={(patch) => setAddress((a) => ({ ...a, ...patch }))} />

          {error ? <p className="text-sm text-[#9B2C2C]">{error}</p> : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={createParty}
              className="px-4 py-2 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save recipient'}
            </button>
            <button
              type="button"
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
      )}
    </div>
  )
}
