'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Props {
  sortBy: 'name' | 'contact'
  sortDir: 'asc' | 'desc'
}

export default function SortHeader({ sortBy, sortDir }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function setSort(field: 'name' | 'contact') {
    const params = new URLSearchParams(searchParams.toString())
    if (sortBy === field) {
      params.set('sort', sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      params.set('sortBy', field)
      params.set('sort', 'asc')
    }
    params.delete('page')
    router.replace(`/clients?${params.toString()}`, { scroll: false })
  }

  function Arrow() {
    return (
      <svg
        className={`w-3 h-3 text-[#0075DD] transition-transform ${
          sortDir === 'desc' ? 'rotate-180' : ''
        }`}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M7 14l5-5 5 5z" />
      </svg>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setSort('name')}
        className={`inline-flex items-center gap-1 hover:text-[#0075DD] ${
          sortBy === 'name' ? 'font-semibold text-[#001B40]' : 'text-[#576981]'
        }`}
      >
        Client Name
        {sortBy === 'name' && <Arrow />}
      </button>
      <span className="text-[#576981]">/</span>
      <button
        type="button"
        onClick={() => setSort('contact')}
        className={`inline-flex items-center gap-1 hover:text-[#0075DD] ${
          sortBy === 'contact' ? 'font-semibold text-[#001B40]' : 'text-[#576981]'
        }`}
      >
        Primary Contact
        {sortBy === 'contact' && <Arrow />}
      </button>
    </span>
  )
}
