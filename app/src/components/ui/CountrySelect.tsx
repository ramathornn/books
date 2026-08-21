'use client'

const COUNTRIES = [
  'Canada',
  'United States',
  'United Kingdom',
  'Germany',
  'France',
  'Spain',
  'Italy',
  'Netherlands',
  'Belgium',
  'Austria',
  'Ireland',
  'Portugal',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
  'Switzerland',
  'Australia',
  'New Zealand',
  'Mexico',
  'Brazil',
  'Argentina',
  'Japan',
  'Singapore',
  'United Arab Emirates',
]

interface Props {
  value: string
  onChange: (v: string) => void
}

export default function CountrySelect({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
    >
      <option value="">Select a country</option>
      {COUNTRIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )
}
