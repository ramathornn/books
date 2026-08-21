'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { RANGE_OPTIONS, type DateRangeKey } from '@/lib/dateRanges'

interface Props {
  paramName: string
  selected: DateRangeKey
  /** What text shows on the trigger button (e.g. "for Jan 1, 2026 to Dec 31, 2026"). */
  triggerLabel: string
}

export default function DateRangeSelector({
  paramName,
  selected,
  triggerLabel,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleChange(value: DateRangeKey) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'this-year') {
      params.delete(paramName)
    } else {
      params.set(paramName, value)
    }
    const qs = params.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-[#576981] hover:text-[#001B40] transition-colors"
      >
        {triggerLabel}
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 mt-1 w-44 bg-white rounded-md shadow-lg border border-[#E1E6EB] py-1 z-50">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
                selected === opt.value
                  ? 'bg-[#F5F7FA] text-[#001B40] font-semibold'
                  : 'text-[#001B40] hover:bg-[#F5F7FA]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
