'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Props {
  label: string
  sortKey: string
  currentSort: string
  currentOrder: string
  align?: 'left' | 'right'
}

export default function InvoiceSortHeader({ label, sortKey, currentSort, currentOrder, align = 'left' }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const isActive = currentSort === sortKey

  function handleClick() {
    const params = new URLSearchParams(searchParams.toString())
    params.set('sortBy', sortKey)
    if (isActive) {
      params.set('sortOrder', currentOrder === 'asc' ? 'desc' : 'asc')
    } else {
      params.set('sortOrder', 'asc')
    }
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1 hover:text-gray-700 transition-colors ${align === 'right' ? 'justify-end' : ''}`}
    >
      <span>{label}</span>
      <span className="inline-flex flex-col leading-none text-[8px]">
        <span className={isActive && currentOrder === 'asc' ? 'text-gray-900' : 'text-gray-300'}>
          {'\u25B2'}
        </span>
        <span className={isActive && currentOrder === 'desc' ? 'text-gray-900' : 'text-gray-300'}>
          {'\u25BC'}
        </span>
      </span>
    </button>
  )
}
