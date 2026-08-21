'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import CountrySelect from '@/components/ui/CountrySelect'

const EUROPEAN_COUNTRIES = new Set([
  'germany', 'france', 'spain', 'italy', 'netherlands', 'belgium', 'austria',
  'ireland', 'portugal', 'sweden', 'norway', 'denmark', 'finland', 'switzerland',
  'united kingdom', 'uk',
])

export default function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [organization, setOrganization] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // Additional phone fields
  const [showBusinessPhone, setShowBusinessPhone] = useState(false)
  const [businessPhone, setBusinessPhone] = useState('')
  const [showMobilePhone, setShowMobilePhone] = useState(false)
  const [mobilePhone, setMobilePhone] = useState('')

  // Address
  const [showAddress, setShowAddress] = useState(false)
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [province, setProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('')
  const [vatId, setVatId] = useState('')

  // Client Settings
  const [sendReminders, setSendReminders] = useState(false)
  const [chargeLate, setChargeLate] = useState(false)
  const [clientCurrency, setClientCurrency] = useState('CAD')
  const [clientLanguage, setClientLanguage] = useState('English (United States)')
  const [invoiceAttachments, setInvoiceAttachments] = useState(false)

  useEffect(() => {
    async function fetchClient() {
      try {
        const res = await fetch(`/api/clients/${id}`)
        if (!res.ok) throw new Error('Failed to load client')
        const data = await res.json()
        setFirstName(data.firstName || '')
        setLastName(data.lastName || '')
        setOrganization(data.organization || '')
        setEmail(data.email || '')

        // Parse phone — might have comma-separated extras
        const phoneParts = (data.phone || '').split(',').map((p: string) => p.trim())
        setPhone(phoneParts[0] || '')
        if (phoneParts[1]) {
          setShowBusinessPhone(true)
          setBusinessPhone(phoneParts[1])
        }
        if (phoneParts[2]) {
          setShowMobilePhone(true)
          setMobilePhone(phoneParts[2])
        }

        // Parse address
        const addr = data.address || ''
        if (addr.trim()) {
          setShowAddress(true)
          const lines = addr.split('\n')
          setStreet(lines[0] || '')
          // Parse city line (city, province, postalCode)
          if (lines[1]) {
            const cityParts = lines[1].split(',').map((p: string) => p.trim())
            setCity(cityParts[0] || '')
            setProvince(cityParts[1] || '')
            setPostalCode(cityParts[2] || '')
          }
          if (lines[2]) setCountry(lines[2])
        }
        if (data.country) setCountry(data.country)
        if (data.vatId) setVatId(data.vatId)
        if (data.currency) setClientCurrency(data.currency)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load client')
      } finally {
        setLoading(false)
      }
    }
    fetchClient()
  }, [id])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    // Validation: either (firstName + lastName) or organization must be provided
    const hasName = firstName.trim() && lastName.trim()
    const hasOrg = organization.trim()
    if (!hasName && !hasOrg) {
      setError('Either First and Last Name or Company Name is required to save this Client.')
      return
    }

    // Compose full address string
    const addressParts = []
    if (street.trim()) addressParts.push(street.trim())
    if (city.trim() || province.trim() || postalCode.trim()) {
      const cityLine = [city.trim(), province.trim(), postalCode.trim()].filter(Boolean).join(', ')
      addressParts.push(cityLine)
    }
    if (country.trim()) addressParts.push(country.trim())
    const fullAddress = addressParts.join('\n')

    // Compose full phone with extras
    const phoneParts = [phone.trim()]
    if (businessPhone.trim()) phoneParts.push(businessPhone.trim())
    if (mobilePhone.trim()) phoneParts.push(mobilePhone.trim())
    const fullPhone = phoneParts.filter(Boolean).join(', ')

    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim() || '',
          lastName: lastName.trim() || '',
          organization: organization.trim(),
          email: email.trim(),
          phone: fullPhone,
          address: fullAddress,
          country: country.trim(),
          vatId: vatId.trim(),
          currency: clientCurrency || 'CAD',
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update client')
      }

      // J3: Save redirects to client detail page
      router.push(`/clients/${id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    router.push(`/clients/${id}`)
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-[#2FA84F]" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Edit Client</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const fakeEvent = { preventDefault: () => {} } as React.FormEvent
              handleSubmit(fakeEvent)
            }}
            disabled={saving}
            className="px-6 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[#FFEBE6] text-[#BF2600] text-sm rounded-md">{error}</div>
      )}

      <div className="flex gap-8">
        {/* Left column: Form fields */}
        <div className="flex-1">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            {/* J1: Info banner */}
            <div className="mb-6 p-3 bg-blue-50 border border-blue-200 rounded-md flex items-start gap-2">
              <svg className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-blue-700">
                Either First and Last Name or Company Name is required to save this Client
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* J2: First + Last Name (2-col) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                  />
                </div>
              </div>

              {/* Company Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Company Name
                </label>
                <input
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                />
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                />
              </div>

              {/* J2: + Add Business Phone */}
              {showBusinessPhone ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Business Phone
                  </label>
                  <input
                    type="tel"
                    value={businessPhone}
                    onChange={(e) => setBusinessPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                  />
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowBusinessPhone(true)}
                    className="text-sm text-[#2FA84F] hover:underline font-medium"
                  >
                    + Add Business Phone
                  </button>
                </div>
              )}

              {/* J2: + Add Mobile Phone */}
              {showMobilePhone ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Mobile Phone
                  </label>
                  <input
                    type="tel"
                    value={mobilePhone}
                    onChange={(e) => setMobilePhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                  />
                </div>
              ) : (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowMobilePhone(true)}
                    className="text-sm text-[#2FA84F] hover:underline font-medium"
                  >
                    + Add Mobile Phone
                  </button>
                </div>
              )}

              {/* J2: + Add Address */}
              {showAddress ? (
                <div className="space-y-4 pt-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Street</label>
                    <input
                      type="text"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Province</label>
                    <input
                      type="text"
                      value={province}
                      onChange={(e) => setProvince(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Postal Code</label>
                    <input
                      type="text"
                      value={postalCode}
                      onChange={(e) => setPostalCode(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                    <CountrySelect value={country} onChange={setCountry} />
                  </div>
                  {EUROPEAN_COUNTRIES.has(country.trim().toLowerCase()) && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        VAT ID <span className="text-gray-400 font-normal">(Optional)</span>
                      </label>
                      <input
                        type="text"
                        value={vatId}
                        onChange={(e) => setVatId(e.target.value)}
                        placeholder="e.g. DE123456789"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAddress(true)}
                  className="text-sm text-[#2FA84F] hover:underline font-medium"
                >
                  + Add Address
                </button>
              )}
            </form>
          </div>
        </div>

        {/* Right column: Client Settings */}
        <div className="w-72 flex-shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-5">Client Settings</h3>
            <div className="space-y-6">
              {/* Send Reminders */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-700">Send Reminders</div>
                </div>
                <button
                  onClick={() => setSendReminders(!sendReminders)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    sendReminders ? 'bg-[#2FA84F]' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={sendReminders}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      sendReminders ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Charge Late Fees */}
              <div className="flex items-start justify-between border-t border-gray-100 pt-4">
                <div>
                  <div className="text-sm font-medium text-gray-700">Charge Late Fees</div>
                  <div className="text-xs text-gray-400 mt-0.5">Percentage or Flat-Rate Fees</div>
                </div>
                <button
                  onClick={() => setChargeLate(!chargeLate)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    chargeLate ? 'bg-[#2FA84F]' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={chargeLate}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      chargeLate ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>

              {/* Currency */}
              <div className="border-t border-gray-100 pt-4">
                <div className="text-sm font-medium text-gray-700 mb-2">Currency</div>
                <select
                  value={clientCurrency}
                  onChange={(e) => setClientCurrency(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                >
                  <option value="CAD">CAD — Canadian dollar</option>
                  <option value="USD">USD — US dollar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British pound</option>
                  <option value="AUD">AUD — Australian dollar</option>
                  <option value="JPY">JPY — Japanese yen</option>
                </select>
              </div>

              {/* Language */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">Language</div>
                <select
                  value={clientLanguage}
                  onChange={(e) => setClientLanguage(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
                >
                  <option value="English (United States)">English (United States)</option>
                </select>
              </div>

              {/* Invoice Attachments */}
              <div className="flex items-start justify-between border-t border-gray-100 pt-4">
                <div>
                  <div className="text-sm font-medium text-gray-700">Invoice Attachments</div>
                  <div className="text-xs text-gray-400 mt-0.5">Attach PDF copy to emails</div>
                </div>
                <button
                  onClick={() => setInvoiceAttachments(!invoiceAttachments)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
                    invoiceAttachments ? 'bg-[#2FA84F]' : 'bg-gray-300'
                  }`}
                  role="switch"
                  aria-checked={invoiceAttachments}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                      invoiceAttachments ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
