'use client'

import { useEffect, useRef, useState } from 'react'

export interface AdvancedFilters {
  company: string
  contact: string
  email: string
  keyword: string
  field: string
}

interface Props {
  filters: AdvancedFilters
  onApply: (f: AdvancedFilters) => void
}

export default function AdvancedSearchPanel({ filters, onApply }: Props) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const [company, setCompany] = useState(filters.company)
  const [contact, setContact] = useState(filters.contact)
  const [email, setEmail] = useState(filters.email)
  const [keyword, setKeyword] = useState(filters.keyword)
  const [field, setField] = useState(filters.field || 'all')

  useEffect(() => {
    if (open) {
      // sync local form with current applied filters when opening
      setCompany(filters.company)
      setContact(filters.contact)
      setEmail(filters.email)
      setKeyword(filters.keyword)
      setField(filters.field || 'all')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  function apply() {
    onApply({ company, contact, email, keyword, field })
    setOpen(false)
  }

  function resetAll() {
    setCompany('')
    setContact('')
    setEmail('')
    setKeyword('')
    setField('all')
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 px-3 h-9 rounded-full border border-[#E1E6EB] bg-white text-sm text-[#001B40] hover:border-[#B5C0CC]"
      >
        <svg
          className="w-4 h-4 text-[#576981]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="7" y1="12" x2="17" y2="12" />
          <line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        Advanced Search
        <svg
          className={`w-3 h-3 text-[#576981] transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M7 10l5 5 5-5z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[820px] bg-white border border-[#E1E6EB] rounded-lg shadow-lg p-5 z-30">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Company Name">
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Search for a company name"
                className={inputCls}
              />
            </Field>
            <Field label="Contact Name">
              <input
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="Search for a contact name"
                className={inputCls}
              />
            </Field>
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Search for a contact email"
                className={inputCls}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="col-span-2">
              <Field label="Keyword Search">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Keywords or Number"
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label={'\u00a0'}>
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className={inputCls + ' bg-white'}
              >
                <option value="all">All Fields</option>
                <option value="invoice">Invoice Number</option>
                <option value="note">Internal Note</option>
              </select>
            </Field>
          </div>

          <div className="flex items-center justify-between mt-5">
            <button
              onClick={resetAll}
              className="text-sm text-[#0075DD] hover:underline"
            >
              Reset all
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setOpen(false)}
                className="px-4 h-9 text-sm text-[#001B40] hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                className="px-4 h-9 rounded bg-[#2FA84F] hover:bg-[#288F44] text-white text-sm font-medium"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="block text-xs text-[#576981] mb-1">{label}</span>
      {children}
    </label>
  )
}
