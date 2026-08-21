'use client'

/**
 * Recipient address fields, shared by the TaxParty form. CRA slips require a
 * mailing address for each recipient; this is the minimal Canadian address
 * block (line1/line2, city, province, postal code, country).
 */

export interface AddressValue {
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
}

const PROVINCES = [
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]

export default function RecipientAddressFields({
  value,
  onChange,
}: {
  value: AddressValue
  onChange: (patch: Partial<AddressValue>) => void
}) {
  const input =
    'w-full rounded-md border border-[#D9E1EC] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="sm:col-span-2">
        <label className="block text-sm font-medium text-[#001B40] mb-1">Address line 1</label>
        <input
          className={input}
          value={value.addressLine1}
          onChange={(e) => onChange({ addressLine1: e.target.value })}
        />
      </div>
      <div className="sm:col-span-2">
        <label className="block text-sm font-medium text-[#001B40] mb-1">Address line 2</label>
        <input
          className={input}
          value={value.addressLine2}
          onChange={(e) => onChange({ addressLine2: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">City</label>
        <input className={input} value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Province</label>
        <select
          className={input}
          value={value.province}
          onChange={(e) => onChange({ province: e.target.value })}
        >
          <option value="">—</option>
          {PROVINCES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Postal code</label>
        <input
          className={input}
          value={value.postalCode}
          onChange={(e) => onChange({ postalCode: e.target.value.toUpperCase() })}
          placeholder="A1A 1A1"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Country</label>
        <input
          className={input}
          value={value.country}
          onChange={(e) => onChange({ country: e.target.value.toUpperCase() })}
          placeholder="CA"
        />
      </div>
    </div>
  )
}
