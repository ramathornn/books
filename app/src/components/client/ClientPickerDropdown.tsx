'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ClientAvatar from './ClientAvatar'

export interface ClientData {
  id: string
  firstName: string
  lastName: string
  organization: string
  email: string
  phone?: string
  address?: string
  country?: string
  vatId?: string
  currency?: string
}

interface Props {
  clients: ClientData[]
  selectedClient: ClientData | null
  onSelect: (client: ClientData) => void
  onClear: () => void
  onCreate: () => void
  onEdit: (client: ClientData) => void
  placeholder?: string
}

function primaryLine(c: ClientData): string {
  return c.organization.trim() || `${c.firstName} ${c.lastName}`.trim() || '(No name)'
}

function secondaryLine(c: ClientData): string {
  const org = c.organization.trim()
  const name = `${c.firstName} ${c.lastName}`.trim()
  if (org && name) return name
  return ''
}

export default function ClientPickerDropdown({
  clients,
  selectedClient,
  onSelect,
  onClear,
  onCreate,
  onEdit,
  placeholder = 'Select a Client',
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) => {
      return (
        c.organization.toLowerCase().includes(q) ||
        c.firstName.toLowerCase().includes(q) ||
        c.lastName.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(q)
      )
    })
  }, [clients, search])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Focus search when opening
  useEffect(() => {
    if (open) {
      setActiveIdx(0)
      setTimeout(() => searchInputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open])

  // Scroll active into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`
    )
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIdx]) {
        onSelect(filtered[activeIdx])
        setOpen(false)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-md text-sm bg-white text-left focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F] min-h-[44px] ${
          selectedClient ? '' : 'text-gray-400'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selectedClient ? (
          <>
            <ClientAvatar
              id={selectedClient.id}
              organization={selectedClient.organization}
              firstName={selectedClient.firstName}
              lastName={selectedClient.lastName}
              size={28}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#001B40] truncate">
                {primaryLine(selectedClient)}
              </div>
              {secondaryLine(selectedClient) && (
                <div className="text-xs text-[#576981] truncate">
                  {secondaryLine(selectedClient)}
                </div>
              )}
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onClear()
                setOpen(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onClear()
                  setOpen(false)
                }
              }}
              className="text-gray-400 hover:text-gray-600 px-1 cursor-pointer flex-shrink-0"
              aria-label="Clear selected client"
            >
              ×
            </span>
          </>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
      </button>
      {selectedClient && (
        <button
          type="button"
          onClick={() => onEdit(selectedClient)}
          className="mt-1 text-[#0075DD] hover:underline text-xs"
        >
          Edit Client
        </button>
      )}

      {open && (
        <div className="absolute z-30 left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden min-w-full w-[340px] max-w-[90vw]">
          <div className="p-2 border-b border-gray-100">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActiveIdx(0)
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search clients..."
              className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
            />
          </div>
          <div
            ref={listRef}
            className="max-h-[480px] overflow-y-auto"
            role="listbox"
          >
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">
                No clients found
              </div>
            )}
            {filtered.map((client, idx) => {
              const isSelected = selectedClient?.id === client.id
              const isActive = idx === activeIdx
              const secondary = secondaryLine(client)
              return (
                <button
                  key={client.id}
                  type="button"
                  data-idx={idx}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => {
                    onSelect(client)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-4 px-4 py-3.5 text-left transition-colors ${
                    isSelected
                      ? 'bg-blue-50'
                      : isActive
                        ? 'bg-gray-50'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <ClientAvatar
                    id={client.id}
                    organization={client.organization}
                    firstName={client.firstName}
                    lastName={client.lastName}
                    size={44}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold text-[#001B40] truncate">
                      {primaryLine(client)}
                    </div>
                    {secondary && (
                      <div className="text-sm text-[#576981] truncate">
                        {secondary}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false)
              onCreate()
            }}
            className="w-full text-left px-4 py-3.5 text-sm text-[#2FA84F] hover:bg-gray-50 border-t border-gray-100 font-semibold"
          >
            + Create a Client
          </button>
        </div>
      )}
    </div>
  )
}
