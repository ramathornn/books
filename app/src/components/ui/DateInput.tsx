'use client'

import { useRef } from 'react'

interface Props {
  value: string
  onChange: (value: string) => void
  className?: string
  ariaLabel?: string
}

function formatDisplay(iso: string) {
  if (!iso) return 'Select date'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${m}/${d}/${y}`
}

export default function DateInput({ value, onChange, className = '', ariaLabel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      el.showPicker()
    } else {
      el.focus()
      el.click()
    }
  }

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={openPicker}
        aria-label={ariaLabel}
        className="inline-flex items-center gap-2 px-2 py-1 text-sm text-[#001B40] rounded border border-transparent hover:border-[#E1E6EB] hover:bg-white focus:outline-none focus:border-[#2FA84F] focus:ring-1 focus:ring-[#2FA84F]"
      >
        <span>{formatDisplay(value)}</span>
        <svg className="w-4 h-4 text-[#576981]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 w-full h-full opacity-0 pointer-events-none"
      />
    </div>
  )
}
