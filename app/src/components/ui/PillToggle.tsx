'use client'

import Link from 'next/link'

export interface PillToggleOption {
  label: string
  value: string
  href?: string
}

interface PillToggleProps {
  options: PillToggleOption[]
  active: string
  onChange?: (value: string) => void
}

export default function PillToggle({ options, active, onChange }: PillToggleProps) {
  return (
    <div className="inline-flex border border-gray-300 rounded-full p-0.5">
      {options.map((opt) => {
        const isActive = opt.value === active
        const className = `px-5 py-1.5 rounded-full text-sm font-medium transition-colors ${
          isActive ? 'bg-[#0075DD] text-white' : 'text-[#001B40] bg-white'
        }`

        if (opt.href) {
          return (
            <Link key={opt.value} href={opt.href} className={className}>
              {opt.label}
            </Link>
          )
        }

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange?.(opt.value)}
            className={className}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
