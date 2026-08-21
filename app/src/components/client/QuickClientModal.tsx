'use client'

import { useState } from 'react'
import Modal from '@/components/ui/Modal'
import CountrySelect from '@/components/ui/CountrySelect'
import type { ClientData } from './ClientPickerDropdown'

interface Props {
  mode: 'create' | 'edit'
  initial?: Partial<ClientData>
  onSaved: (client: ClientData) => void
  onClose: () => void
}

const EUROPEAN_COUNTRIES = new Set([
  'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'austria',
  'ireland', 'portugal', 'sweden', 'norway', 'denmark', 'finland', 'switzerland',
  'united kingdom', 'uk',
])

function parseAddress(address: string): {
  street: string
  city: string
  province: string
  postalCode: string
  country: string
} {
  const lines = (address || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const street = lines[0] || ''
  const country = lines.length >= 3 ? lines[lines.length - 1] : ''
  const cityLineRaw = lines.length >= 3 ? lines[1] : lines[1] || ''
  let city = ''
  let province = ''
  let postalCode = ''
  if (cityLineRaw) {
    const parts = cityLineRaw.split(',').map((p) => p.trim())
    city = parts[0] || ''
    province = parts[1] || ''
    postalCode = parts[2] || ''
  }
  return { street, city, province, postalCode, country }
}

export default function QuickClientModal({
  mode,
  initial,
  onSaved,
  onClose,
}: Props) {
  const parsed = parseAddress(initial?.address || '')

  const [firstName, setFirstName] = useState(initial?.firstName || '')
  const [lastName, setLastName] = useState(initial?.lastName || '')
  const [organization, setOrganization] = useState(initial?.organization || '')
  const [email, setEmail] = useState(initial?.email || '')
  const [phone, setPhone] = useState(initial?.phone || '')
  const [street, setStreet] = useState(parsed.street)
  const [city, setCity] = useState(parsed.city)
  const [province, setProvince] = useState(parsed.province)
  const [postalCode, setPostalCode] = useState(parsed.postalCode)
  const [country, setCountry] = useState(initial?.country || parsed.country || '')
  const [vatId, setVatId] = useState(initial?.vatId || '')
  const [currency, setCurrency] = useState(initial?.currency || 'CAD')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function composeAddress(): string {
    const parts: string[] = []
    if (street.trim()) parts.push(street.trim())
    if (city.trim() || province.trim() || postalCode.trim()) {
      parts.push(
        [city.trim(), province.trim(), postalCode.trim()]
          .filter(Boolean)
          .join(', ')
      )
    }
    if (country.trim()) parts.push(country.trim())
    return parts.join('\n')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const hasName = firstName.trim() && lastName.trim()
    const hasOrg = organization.trim()
    if (!hasName && !hasOrg) {
      setError(
        'Either First and Last Name or Company Name is required to save this Client.'
      )
      return
    }

    setSaving(true)
    try {
      const body = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        organization: organization.trim(),
        email: email.trim(),
        phone: phone.trim(),
        address: composeAddress(),
        country: country.trim(),
        vatId: vatId.trim(),
        currency: currency || 'CAD',
      }

      let res: Response
      if (mode === 'create') {
        res = await fetch('/api/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        if (!initial?.id) throw new Error('Missing client id for edit')
        res = await fetch(`/api/clients/${initial.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save client')
      }

      const data = (await res.json()) as ClientData
      onSaved(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const showVat = EUROPEAN_COUNTRIES.has(country.trim().toLowerCase())
  const input =
    'w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]'
  const label = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={mode === 'create' ? 'New Client' : 'Edit Client'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-[#FFEBE6] text-[#BF2600] text-sm rounded-md">
            {error}
          </div>
        )}

        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
          <p className="text-xs text-blue-700">
            Either First and Last Name or Company Name is required.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>First Name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Last Name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={input}
            />
          </div>
        </div>

        <div>
          <label className={label}>Company Name</label>
          <input
            type="text"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            className={input}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </div>
          <div>
            <label className={label}>Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={input}
            />
          </div>
        </div>

        <div className="pt-2 border-t border-gray-100">
          <div className="text-sm font-semibold text-[#001B40] mb-3">Address</div>
          <div className="space-y-4">
            <div>
              <label className={label}>Street</label>
              <input
                type="text"
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                className={input}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={label}>City</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Province</label>
                <input
                  type="text"
                  value={province}
                  onChange={(e) => setProvince(e.target.value)}
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Postal Code</label>
                <input
                  type="text"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className={input}
                />
              </div>
            </div>
            <div>
              <label className={label}>Country</label>
              <CountrySelect value={country} onChange={setCountry} />
            </div>
            {showVat && (
              <div>
                <label className={label}>
                  VAT ID{' '}
                  <span className="text-gray-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={vatId}
                  onChange={(e) => setVatId(e.target.value)}
                  placeholder="DE123456789"
                  className={input}
                />
              </div>
            )}
          </div>
        </div>

        <div>
          <label className={label}>Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className={`${input} bg-white`}
          >
            <option value="CAD">CAD — Canadian dollar</option>
            <option value="USD">USD — US dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British pound</option>
            <option value="AUD">AUD — Australian dollar</option>
            <option value="JPY">JPY — Japanese yen</option>
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 sticky bottom-0 bg-white -mx-4 px-4 pb-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
