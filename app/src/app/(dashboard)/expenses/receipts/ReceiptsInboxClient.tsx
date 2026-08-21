'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface AttachmentRef {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

interface Receipt {
  id: string
  date: string
  vendorName: string
  categoryName: string
  amount: number
  taxAmount: number
  currency: string
  description: string
  isReceiptDraft: boolean
  createdAt: string
  attachments: AttachmentRef[]
}

type Tab = 'for_review' | 'reviewed'

export default function ReceiptsInboxClient() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('for_review')
  const [items, setItems] = useState<Receipt[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`/api/receipts?status=${tab}`)
      const data = await res.json()
      setItems(data.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return
    setError('')
    setUploading(true)
    try {
      const fd = new FormData()
      for (const f of Array.from(files)) fd.append('files', f)
      const res = await fetch('/api/receipts', { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Upload failed')
      }
      setTab('for_review')
      await refresh()
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          upload(e.dataTransfer.files)
        }}
        className="mb-6 border-2 border-dashed border-[#E1E6EB] rounded-lg p-8 text-center bg-white hover:border-[#0075DD] transition-colors"
      >
        <svg className="w-10 h-10 mx-auto text-[#8C9BAB] mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 0115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
        </svg>
        <p className="text-sm text-[#001B40] mb-1">
          Drop receipts here or{' '}
          <button
            onClick={() => inputRef.current?.click()}
            className="text-[#0075DD] hover:underline"
          >
            click to upload
          </button>
        </p>
        <p className="text-xs text-[#576981]">PDF, JPG, PNG, HEIC up to 25 MB each.</p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
        {uploading && <p className="text-xs text-[#0075DD] mt-2">Uploading…</p>}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="flex border-b border-[#E1E6EB]">
          <button
            onClick={() => setTab('for_review')}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${
              tab === 'for_review'
                ? 'text-[#0075DD] border-[#0075DD]'
                : 'text-[#576981] border-transparent hover:text-[#001B40]'
            }`}
          >
            For Review
          </button>
          <button
            onClick={() => setTab('reviewed')}
            className={`px-4 py-3 text-sm font-medium border-b-2 ${
              tab === 'reviewed'
                ? 'text-[#0075DD] border-[#0075DD]'
                : 'text-[#576981] border-transparent hover:text-[#001B40]'
            }`}
          >
            Reviewed
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-[#576981]">Loading…</div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#576981]">
            {tab === 'for_review'
              ? 'No receipts waiting for review. Drop a file above to get started.'
              : 'No reviewed receipts yet.'}
          </div>
        ) : (
          <ul className="divide-y divide-[#E1E6EB]">
            {items.map((r) => (
              <li key={r.id} className="p-4 hover:bg-[#F5F7FA]/50">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-12 h-12 bg-[#F5F7FA] rounded flex items-center justify-center">
                    <span className="text-[10px] font-semibold text-[#576981]">
                      {r.attachments[0]?.mimeType.includes('pdf') ? 'PDF' : 'IMG'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#001B40] truncate">
                      {r.attachments[0]?.fileName || r.description || 'Receipt'}
                    </div>
                    <div className="text-xs text-[#576981]">
                      {r.vendorName || '— vendor —'} · {r.categoryName || '— category —'} ·{' '}
                      {r.amount > 0
                        ? formatCurrency(r.amount + r.taxAmount, r.currency, { includeCode: false })
                        : 'no amount yet'}
                    </div>
                    <div className="text-[10px] text-[#8C9BAB] mt-0.5">
                      Uploaded {new Date(r.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {r.attachments[0] && (
                      <a
                        href={`/api/attachments/${r.attachments[0].id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#0075DD] hover:underline"
                      >
                        View file
                      </a>
                    )}
                    <Link
                      href={`/expenses/${r.id}`}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-[#0075DD] hover:bg-[#005FB3] rounded"
                    >
                      Review
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
