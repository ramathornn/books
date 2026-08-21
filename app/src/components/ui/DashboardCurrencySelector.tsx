'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

interface DashboardCurrencySelectorProps {
  selected: string
}

export default function DashboardCurrencySelector({ selected }: DashboardCurrencySelectorProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currencies = ['CAD', 'USD', 'EUR']
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

  function handleChange(currency: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('currency', currency)
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
      >
        {selected}
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-24 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
          {currencies.map((currency) => (
            <button
              key={currency}
              onClick={() => handleChange(currency)}
              className={`block w-full text-left px-3 py-1.5 text-xs font-medium transition-colors ${
                selected === currency
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {currency}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
