'use client'

import { useRef, useState } from 'react'

interface Candidate {
  id: string
  date: string
  amount: number
  description: string
}

type IngestResponse =
  | { status: 'attached'; journalEntryId: string; vendor: string | null }
  | { status: 'candidates'; vendor: string | null; ocr: Record<string, unknown>; candidates: Candidate[] }
  | { status: 'no_match'; vendor: string | null; ocr: Record<string, unknown> }
  | { status: 'unsupported' }
  | { status: 'ocr_failed' }
  | { error: string }

/**
 * Drop a receipt/invoice → OCR → auto-attach to its posted JE, or pick from
 * ranked candidates. Never auto-attaches on a guess (the server decides).
 */
export default function DocumentDropZone() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<IngestResponse | null>(null)
  const [message, setMessage] = useState('')

  async function ingest(f: File) {
    setBusy(true)
    setResult(null)
    setMessage('')
    setFile(f)
    try {
      const fd = new FormData()
      fd.set('file', f)
      const res = await fetch('/api/documents/ingest', { method: 'POST', body: fd })
      setResult((await res.json()) as IngestResponse)
    } catch {
      setMessage('Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function confirmAttach(c: Candidate) {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('file', file)
      fd.set('journalEntryId', c.id)
      if (result && 'ocr' in result && result.ocr) fd.set('ocr', JSON.stringify(result.ocr))
      const res = await fetch('/api/documents/attach', { method: 'POST', body: fd })
      if (res.ok) {
        setResult({ status: 'attached', journalEntryId: c.id, vendor: null })
      } else {
        setMessage('Attach failed.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 mb-6">
      <h2 className="text-sm font-semibold text-[#001B40] mb-2">Drop a receipt to auto-match</h2>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files?.[0]
          if (f) void ingest(f)
        }}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded border-2 border-dashed px-4 py-8 text-center text-sm ${
          dragOver ? 'border-[#0075DD] bg-[#F0F7FF]' : 'border-[#E1E6EB] text-[#576981]'
        }`}
      >
        {busy ? 'Working…' : 'Drop a PDF or image here, or click to choose. It will OCR and attach to its transaction.'}
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void ingest(f)
          }}
        />
      </div>

      {message && <p className="mt-3 text-sm text-[#BF2600]">{message}</p>}

      {result && 'error' in result && <p className="mt-3 text-sm text-[#BF2600]">{result.error}</p>}

      {result && 'status' in result && result.status === 'attached' && (
        <p className="mt-3 text-sm text-[#006644]">
          ✓ Attached to{' '}
          <a href={`/accounting/journal-entries/${result.journalEntryId}`} className="text-[#0075DD] hover:underline">
            its journal entry
          </a>
          .
        </p>
      )}

      {result && 'status' in result && result.status === 'ocr_failed' && (
        <p className="mt-3 text-sm text-[#576981]">Couldn’t read this document. Attach it manually from the entry.</p>
      )}
      {result && 'status' in result && result.status === 'unsupported' && (
        <p className="mt-3 text-sm text-[#576981]">Unsupported file type — upload a PDF or image.</p>
      )}
      {result && 'status' in result && result.status === 'no_match' && (
        <p className="mt-3 text-sm text-[#576981]">
          No matching transaction found{result.vendor ? ` for ${result.vendor}` : ''}. Attach it manually from the entry.
        </p>
      )}

      {result && 'status' in result && result.status === 'candidates' && (
        <div className="mt-3">
          <p className="text-sm text-[#576981] mb-2">
            Couldn’t pick a single match{result.vendor ? ` for ${result.vendor}` : ''} — choose the right transaction:
          </p>
          <ul className="divide-y divide-[#E1E6EB] border border-[#E1E6EB] rounded">
            {result.candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="text-[#001B40]">
                  {c.date} · {c.amount.toFixed(2)} · {c.description || '—'}
                </span>
                <button
                  disabled={busy}
                  onClick={() => void confirmAttach(c)}
                  className="px-3 py-1 text-xs font-medium text-white bg-[#001B40] rounded hover:opacity-90 disabled:opacity-50"
                >
                  Attach here
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
