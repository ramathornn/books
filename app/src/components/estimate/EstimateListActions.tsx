'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PrimaryButton from '@/components/ui/PrimaryButton'
import CsvImportModal from '@/components/ui/CsvImportModal'

const ESTIMATE_IMPORT_COLUMNS = [
  'Estimate Number',
  'Client Email',
  'Status',
  'Date Issued',
  'Currency',
  'Description',
  'Line Description',
  'Line Rate',
  'Line Quantity',
]

export default function EstimateListActions() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
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

  function handleExport() {
    setOpen(false)
    const qs = window.location.search.replace(/^\?/, '')
    const url = `/api/estimates/export${qs ? `?${qs}` : ''}`
    window.location.href = url
  }

  function handleImport() {
    setOpen(false)
    setImportOpen(true)
  }

  function handlePrint() {
    setOpen(false)
    setTimeout(() => window.print(), 50)
  }

  async function doImport(rows: Record<string, string>[]) {
    const res = await fetch('/api/estimates/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => 'Server error')
      return { imported: 0, errors: [{ row: 0, message: text }] }
    }
    const json = (await res.json()) as {
      imported: number
      errors: { row: number; message: string }[]
    }
    if (json.imported > 0) router.refresh()
    return json
  }

  return (
    <>
      <div className="relative" ref={ref} data-print="hide">
        <button
          onClick={() => setOpen(!open)}
          className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#001B40] rounded-md hover:bg-gray-50 transition-colors inline-flex items-center gap-1"
        >
          More Actions
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            <button
              onClick={handleImport}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Import Estimates
            </button>
            <button
              onClick={handleExport}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Export as CSV
            </button>
            <button
              onClick={handlePrint}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Print List
            </button>
          </div>
        )}
      </div>
      {importOpen && (
        <CsvImportModal
          title="Import Estimates"
          sampleColumns={ESTIMATE_IMPORT_COLUMNS}
          onClose={() => setImportOpen(false)}
          onImport={doImport}
        />
      )}
    </>
  )
}

export function CreateNewEstimateDropdown() {
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
      <PrimaryButton onClick={() => setOpen(!open)}>
        <span className="inline-flex items-center gap-1.5">
          Create New
          <span aria-hidden="true">▾</span>
        </span>
      </PrimaryButton>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          <Link
            href="/estimates/new"
            className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            onClick={() => setOpen(false)}
          >
            New Estimate
          </Link>
          <button
            type="button"
            disabled
            title="Coming Soon"
            className="w-full text-left px-4 py-2 text-sm text-gray-400 cursor-not-allowed"
          >
            New Proposal
          </button>
        </div>
      )}
    </div>
  )
}
