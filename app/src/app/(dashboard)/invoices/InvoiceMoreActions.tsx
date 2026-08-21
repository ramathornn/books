'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import CsvImportModal from '@/components/ui/CsvImportModal'

const INVOICE_IMPORT_COLUMNS = [
  'Invoice Number',
  'Client Email',
  'Status',
  'Date Issued',
  'Date Due',
  'Currency',
  'Description',
  'Reference',
  'Line Description',
  'Line Rate',
  'Line Quantity',
]

export default function InvoiceMoreActions() {
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
    // The list section keeps window.location.search in sync with the live
    // filter state, so we can read it at click time.
    const qs = window.location.search.replace(/^\?/, '')
    const url = `/api/invoices/export${qs ? `?${qs}` : ''}`
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
    const res = await fetch('/api/invoices/import', {
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
      <div ref={ref} className="relative" data-print="hide">
        <button
          onClick={() => setOpen(!open)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-1.5"
        >
          More Actions
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {open && (
          <div className="absolute right-0 mt-1 w-52 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
            <button
              onClick={handleImport}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Import Invoices
            </button>
            <button
              onClick={handleExport}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Export as CSV
            </button>
            <button
              onClick={handlePrint}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Print List
            </button>
          </div>
        )}
      </div>
      {importOpen && (
        <CsvImportModal
          title="Import Invoices"
          sampleColumns={INVOICE_IMPORT_COLUMNS}
          onClose={() => setImportOpen(false)}
          onImport={doImport}
        />
      )}
    </>
  )
}
