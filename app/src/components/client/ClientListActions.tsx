'use client'

import { useState, useRef, useEffect } from 'react'

export default function ClientListActions() {
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

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#001B40] rounded hover:bg-gray-50 transition-colors inline-flex items-center gap-1"
      >
        More Actions
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Archive Client
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            Delete Client
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Import from CSV
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Export to CSV
          </button>
        </div>
      )}
    </div>
  )
}
