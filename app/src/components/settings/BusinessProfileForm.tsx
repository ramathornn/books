'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CompanyInfo } from '@/lib/company'
import { fiscalYearBounds, fiscalYearOf, maxDayInMonth } from '@/lib/fiscalYear'

interface Props {
  initial: CompanyInfo
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

type FormState = Pick<
  CompanyInfo,
  | 'name'
  | 'legalName'
  | 'logoInitials'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'province'
  | 'postalCode'
  | 'country'
  | 'phone'
  | 'email'
  | 'website'
  | 'defaultCurrency'
  | 'albertaCorporateAccountNumber'
  | 't2ProgramAccount'
  | 'fiscalYearEnd'
>

function toFormState(c: CompanyInfo): FormState {
  return {
    name: c.name,
    legalName: c.legalName,
    logoInitials: c.logoInitials,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    province: c.province,
    postalCode: c.postalCode,
    country: c.country,
    phone: c.phone,
    email: c.email,
    website: c.website,
    defaultCurrency: c.defaultCurrency,
    albertaCorporateAccountNumber: c.albertaCorporateAccountNumber,
    t2ProgramAccount: c.t2ProgramAccount,
    fiscalYearEnd: c.fiscalYearEnd,
  }
}

export default function BusinessProfileForm({ initial }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<FormState>(toFormState(initial))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function update<K extends keyof FormState>(key: K, val: FormState[K]) {
    setValues((v) => ({ ...v, [key]: val }))
  }

  /**
   * Changing the month can strand the day (Jan 31 → February). Clamp it down to
   * the new month's longest possible day rather than letting the server reject
   * a combination the user never deliberately chose.
   */
  function updateFiscalMonth(month: number) {
    setValues((v) => ({
      ...v,
      fiscalYearEnd: { month, day: Math.min(v.fiscalYearEnd.day, maxDayInMonth(month)) },
    }))
  }

  const fyBounds = fiscalYearBounds(fiscalYearOf(new Date(), values.fiscalYearEnd), values.fiscalYearEnd)
  const fmtFy = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The API takes the year-end flat; the nested `fiscalYearEnd` object is
        // ignored by the schema.
        body: JSON.stringify({
          ...values,
          fiscalYearEndMonth: values.fiscalYearEnd.month,
          fiscalYearEndDay: values.fiscalYearEnd.day,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save settings')
      }
      setMessage({ type: 'success', text: 'Business profile saved.' })
      // The fiscal year-end feeds server-rendered pages (the report preset
      // dropdowns); refresh so they don't keep serving the previous value.
      router.refresh()
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save',
      })
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#0075DD] focus:border-[#0075DD]'

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-sm shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">Business Profile</h2>

      {message && (
        <div
          className={`mb-4 p-3 text-sm rounded-md ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-5">
        {/* Logo */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Logo</label>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-lg bg-[#0075DD] flex items-center justify-center text-white font-bold text-xl">
              {values.logoInitials || '?'}
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Logo Initials
              </label>
              <input
                type="text"
                value={values.logoInitials}
                onChange={(e) => update('logoInitials', e.target.value)}
                maxLength={4}
                className={inputClass + ' max-w-[120px]'}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Business Name
            </label>
            <input
              type="text"
              value={values.name}
              onChange={(e) => update('name', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Legal Name
            </label>
            <input
              type="text"
              value={values.legalName}
              onChange={(e) => update('legalName', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="text"
              value={values.phone}
              onChange={(e) => update('phone', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="text"
              value={values.email}
              onChange={(e) => update('email', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
          <input
            type="text"
            value={values.website}
            onChange={(e) => update('website', e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Address Line 1
          </label>
          <input
            type="text"
            value={values.addressLine1}
            onChange={(e) => update('addressLine1', e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Address Line 2
          </label>
          <input
            type="text"
            value={values.addressLine2}
            onChange={(e) => update('addressLine2', e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
            <input
              type="text"
              value={values.city}
              onChange={(e) => update('city', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Province / State
            </label>
            <input
              type="text"
              value={values.province}
              onChange={(e) => update('province', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Postal / Zip
            </label>
            <input
              type="text"
              value={values.postalCode}
              onChange={(e) => update('postalCode', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
            <input
              type="text"
              value={values.country}
              onChange={(e) => update('country', e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Default Currency
            </label>
            <input
              type="text"
              value={values.defaultCurrency}
              onChange={(e) => update('defaultCurrency', e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Fiscal year end</h3>
          <p className="text-xs text-gray-400 mb-3">
            The date your financial year closes. Drives the fiscal date presets on every report and the
            year-end that CCA depreciation is claimed against. Leave at December 31 if your fiscal year
            is the calendar year.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fye-month" className="block text-sm font-medium text-gray-700 mb-1">
                Month
              </label>
              <select
                id="fye-month"
                value={values.fiscalYearEnd.month}
                onChange={(e) => updateFiscalMonth(Number(e.target.value))}
                className={inputClass}
              >
                {MONTHS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fye-day" className="block text-sm font-medium text-gray-700 mb-1">
                Day
              </label>
              <select
                id="fye-day"
                value={values.fiscalYearEnd.day}
                onChange={(e) =>
                  update('fiscalYearEnd', { ...values.fiscalYearEnd, day: Number(e.target.value) })
                }
                className={inputClass}
              >
                {Array.from({ length: maxDayInMonth(values.fiscalYearEnd.month) }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Current fiscal year: <strong>{fmtFy(fyBounds.start)} – {fmtFy(fyBounds.end)}</strong>
          </p>
          {values.fiscalYearEnd.month === 2 && values.fiscalYearEnd.day === 29 && (
            <p className="mt-1 text-xs text-gray-400">
              February 29 falls back to the 28th in non-leap years.
            </p>
          )}
        </div>

        <div className="pt-4 border-t border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Corporate tax (T2 / AT1)</h3>
          <p className="text-xs text-gray-400 mb-3">
            Required to prepare the federal T2 and the Alberta AT1. The AT1 is filed separately to Alberta TRA.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BN + program account
              </label>
              <input
                type="text"
                value={values.t2ProgramAccount}
                onChange={(e) => update('t2ProgramAccount', e.target.value.toUpperCase())}
                placeholder="123456789RC0001"
                maxLength={15}
                className={inputClass + ' font-mono'}
              />
              <p className="mt-1 text-xs text-gray-400">9 digits + RC0001 (the corporate-income program account).</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Alberta Corporate Account Number
              </label>
              <input
                type="text"
                value={values.albertaCorporateAccountNumber}
                onChange={(e) => update('albertaCorporateAccountNumber', e.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="0000000000"
                maxLength={10}
                className={inputClass + ' font-mono'}
              />
              <p className="mt-1 text-xs text-gray-400">10 digits — required for the Alberta AT1.</p>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </form>
  )
}
