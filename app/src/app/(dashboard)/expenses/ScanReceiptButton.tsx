'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// "Scan receipt" — opens the device camera / photo library (on phones the OS
// sheet offers Take Photo, Photo Library, and Choose File), uploads to the
// existing /api/receipts OCR pipeline, and jumps to the created draft expense
// for review.
export default function ScanReceiptButton() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(files: FileList | null) {
    if (!files || files.length === 0) return
    setBusy(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('files', f)
      const res = await fetch('/api/receipts', { method: 'POST', body: fd })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      const firstId = data.created?.[0]?.id
      // Navigate straight to the draft so the user can confirm the parsed fields.
      router.push(firstId ? `/expenses/${firstId}` : '/expenses/receipts')
      router.refresh()
    } catch (e) {
      alert(`Could not scan receipt: ${e instanceof Error ? e.message : 'error'}`)
      setBusy(false)
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] transition-colors disabled:opacity-50"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8a2 2 0 012-2h2l1.2-1.6A2 2 0 019.8 3.6h4.4a2 2 0 011.6.8L17 6h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
          <circle cx="12" cy="12.5" r="3.2" />
        </svg>
        {busy ? 'Scanning…' : 'Scan receipt'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => onFile(e.target.files)}
      />
    </>
  )
}
