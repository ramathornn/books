'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useSidebar } from './SidebarContext'

export default function Topbar({ readOnly = false, userName = '' }: { readOnly?: boolean; userName?: string }) {
  const initials =
    userName
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  const router = useRouter()
  const { toggle } = useSidebar()
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (searchQuery.trim()) {
      router.push(`/invoices?search=${encodeURIComponent(searchQuery.trim())}`)
      setSearchQuery('')
      setSearchOpen(false)
    }
  }

  return (
    <div className="sticky top-0 z-30 bg-white border-b border-[#E1E6EB] h-16 px-4 sm:px-8">
      <div className="max-w-[1200px] mx-auto h-full flex items-center gap-3">
      {/* Mobile hamburger */}
      <button
        onClick={toggle}
        aria-label="Toggle navigation"
        className="lg:hidden w-9 h-9 -ml-1 flex items-center justify-center text-gray-600 hover:text-gray-900 rounded-md hover:bg-gray-100"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="flex-1" />
      {/* Search input */}
      {searchOpen ? (
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search invoices..."
              autoFocus
              className="w-52 h-8 pl-8 pr-3 text-sm bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]"
              onBlur={() => {
                if (!searchQuery.trim()) {
                  setSearchOpen(false)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchQuery('')
                  setSearchOpen(false)
                }
              }}
            />
          </div>
        </form>
      ) : (
        <button
          onClick={() => setSearchOpen(true)}
          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 transition-colors rounded-full hover:bg-gray-100"
        >
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
      )}

      {/* User Avatar + menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="w-8 h-8 rounded-full border-2 border-[#0075DD] flex items-center justify-center text-[#0075DD] text-[11px] font-bold bg-white hover:bg-blue-50 transition-colors"
        >
          {initials}
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 mt-2 w-44 bg-white border border-[#E1E6EB] rounded-md shadow-lg py-1 z-40"
          >
            {!readOnly && (
              <>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    router.push('/settings')
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Settings
                </button>
                <div className="my-1 h-px bg-[#E1E6EB]" />
              </>
            )}
            <button
              role="menuitem"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full text-left px-4 py-2 text-sm text-[#BF2600] hover:bg-red-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
