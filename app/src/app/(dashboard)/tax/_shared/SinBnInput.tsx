'use client'

import { useState } from 'react'
import { isValidSinClient, isPlausibleBn, normalizeDigits } from './luhn'

/**
 * SIN / Business-Number input with live validation, shared by the recipient
 * (TaxParty) form. For an `individual` recipient it collects a 9-digit SIN
 * (Luhn-checked, formatted ###-###-###); for a `business` it collects a CRA BN.
 *
 * The SIN value is NEVER round-tripped to the browser once stored — the form
 * sends the raw value on save and the server encrypts it (AES-GCM) and returns
 * only `sinLast3` for masking. This component is for entry/validation only.
 */
export default function SinBnInput({
  kind,
  sinValue,
  bnValue,
  sinOnFileLast3,
  onSinChange,
  onBnChange,
}: {
  kind: 'individual' | 'business'
  sinValue: string
  bnValue: string
  /** when editing an existing party with a stored SIN, show the mask. */
  sinOnFileLast3?: string | null
  onSinChange: (v: string) => void
  onBnChange: (v: string) => void
}) {
  const [touched, setTouched] = useState(false)

  if (kind === 'business') {
    const ok = bnValue.trim() === '' || isPlausibleBn(bnValue)
    return (
      <div>
        <label className="block text-sm font-medium text-[#001B40] mb-1">Business Number (BN)</label>
        <input
          value={bnValue}
          onChange={(e) => onBnChange(e.target.value.toUpperCase())}
          onBlur={() => setTouched(true)}
          placeholder="123456789RZ0001"
          className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
            touched && !ok ? 'border-[#E0584C]' : 'border-[#D9E1EC]'
          }`}
        />
        {touched && !ok ? (
          <p className="text-xs text-[#9B2C2C] mt-1">
            Enter a 9-digit BN, optionally with the RZ program account (e.g. 123456789RZ0001).
          </p>
        ) : (
          <p className="text-xs text-[#94A3B8] mt-1">Required for a business recipient (info-return RZ account).</p>
        )}
      </div>
    )
  }

  const digits = normalizeDigits(sinValue)
  const ok = sinValue.trim() === '' || isValidSinClient(sinValue)
  const formatted =
    digits.length > 6
      ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 9)}`
      : digits.length > 3
        ? `${digits.slice(0, 3)}-${digits.slice(3)}`
        : digits

  return (
    <div>
      <label className="block text-sm font-medium text-[#001B40] mb-1">
        Social Insurance Number (SIN)
      </label>
      {sinOnFileLast3 ? (
        <p className="text-xs text-[#256A3A] mb-1">
          A SIN ending •••-••-{sinOnFileLast3} is encrypted on file. Leave blank to keep it; enter a new
          SIN to replace it.
        </p>
      ) : null}
      <input
        value={formatted}
        inputMode="numeric"
        autoComplete="off"
        onChange={(e) => onSinChange(normalizeDigits(e.target.value).slice(0, 9))}
        onBlur={() => setTouched(true)}
        placeholder="000-000-000"
        className={`w-full rounded-md border px-3 py-2 text-sm font-mono ${
          touched && !ok ? 'border-[#E0584C]' : 'border-[#D9E1EC]'
        }`}
      />
      {touched && !ok ? (
        <p className="text-xs text-[#9B2C2C] mt-1">Not a valid SIN (must be 9 digits and pass the checksum).</p>
      ) : (
        <p className="text-xs text-[#94A3B8] mt-1">Stored encrypted (AES-GCM); never shown again in full.</p>
      )}
    </div>
  )
}
