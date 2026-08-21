'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'

interface SearchInputProps {
  placeholder?: string
  variant?: 'default' | 'pill'
}

export default function SearchInput({
  placeholder = 'Search...',
  variant = 'default',
}: SearchInputProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('search') || '')

  useEffect(() => {
    const debounce = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) {
        params.set('search', query)
        params.delete('page')
      } else {
        params.delete('search')
      }
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    }, 300)
    return () => clearTimeout(debounce)
  }, [query, pathname, router, searchParams])

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg
          className="h-4 w-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className={
          variant === 'pill'
            ? 'block w-full pl-9 pr-3 h-9 border border-[#E1E6EB] rounded-full text-sm placeholder-[#8C9BAB] focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'
            : 'block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]'
        }
      />
    </div>
  )
}
