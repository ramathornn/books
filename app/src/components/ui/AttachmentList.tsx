'use client'

import { useEffect, useState, useRef } from 'react'

interface Attachment {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

interface Props {
  entityType: string
  entityId: string
  /**
   * If the entity isn't created yet (e.g. on the New Expense form), pass null
   * and we'll show the empty state without trying to fetch.
   */
  enabled?: boolean
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isImage(mime: string) {
  return mime.startsWith('image/')
}

function isPdf(mime: string) {
  return mime === 'application/pdf'
}

export default function AttachmentList({ entityType, entityId, enabled = true }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!enabled || !entityId) {
      setLoaded(true)
      return
    }
    let cancelled = false
    fetch(`/api/attachments?entityType=${entityType}&entityId=${entityId}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        setAttachments(d.data || [])
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      cancelled = true
    }
  }, [entityType, entityId, enabled])

  async function upload(files: FileList | null) {
    if (!files || !files.length || !entityId) return
    setError('')
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('entityType', entityType)
        fd.append('entityId', entityId)
        fd.append('file', file)
        const res = await fetch('/api/attachments', { method: 'POST', body: fd })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || 'Upload failed')
        }
        const created = await res.json()
        setAttachments((prev) => [created, ...prev])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this attachment?')) return
    const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' })
    if (res.ok) setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  if (!enabled || !entityId) {
    return (
      <div className="text-xs text-[#576981]">
        Save first — then you can attach receipts and supporting documents here.
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#576981]">
          {loaded ? `${attachments.length} attached` : 'Loading…'}
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-xs text-[#0075DD] hover:underline disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : '+ Add file'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif"
          multiple
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />
      </div>

      {error && <div className="mb-2 text-xs text-[#BF2600]">{error}</div>}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          upload(e.dataTransfer.files)
        }}
        className="border-2 border-dashed border-[#E1E6EB] rounded p-3"
      >
        {attachments.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-xs text-[#576981]">
              Drop a PDF or image here to attach. Up to 25 MB each.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-sm">
                <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded bg-[#F5F7FA] text-[#576981] text-[10px] font-semibold">
                  {isPdf(a.mimeType) ? 'PDF' : isImage(a.mimeType) ? 'IMG' : 'FILE'}
                </span>
                <div className="flex-1 min-w-0">
                  <a
                    href={`/api/attachments/${a.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-[#0075DD] hover:underline"
                  >
                    {a.fileName}
                  </a>
                  <div className="text-[11px] text-[#8C9BAB]">
                    {fmtSize(a.sizeBytes)} · {new Date(a.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => remove(a.id)}
                  className="text-[11px] text-[#BF2600] hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
