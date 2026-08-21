'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const ATTACHMENT_ACCEPT =
  'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif'

interface Account {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
}

interface Line {
  id: string
  glAccountId: string
  description: string
  debit: number
  credit: number
}

interface Props {
  mode: 'new' | 'edit'
  accounts: Account[]
  entry?: {
    id: string
    entryNumber: string
    entryDate: string
    description: string
    memo: string
    status: string
    reversesId?: string | null
    reversedReason?: string | null
    reverses?: { id: string; entryNumber: string } | null
    reversal?: { id: string; entryNumber: string } | null
    lines: Array<{
      id: string
      glAccountId: string
      description: string
      debit: number
      credit: number
    }>
  }
}

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

export default function JournalEntryForm({ mode, accounts, entry }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [staged, setStaged] = useState<File[]>([])
  const stagedInputRef = useRef<HTMLInputElement>(null)
  const [reversing, setReversing] = useState(false)

  const [entryDate, setEntryDate] = useState(
    entry?.entryDate ? entry.entryDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  )
  const [description, setDescription] = useState(entry?.description || '')
  const [memo, setMemo] = useState(entry?.memo || '')
  const [lines, setLines] = useState<Line[]>(
    entry?.lines && entry.lines.length
      ? entry.lines.map((l) => ({
          id: l.id,
          glAccountId: l.glAccountId,
          description: l.description,
          debit: Number(l.debit),
          credit: Number(l.credit),
        }))
      : [
          { id: genId(), glAccountId: '', description: '', debit: 0, credit: 0 },
          { id: genId(), glAccountId: '', description: '', debit: 0, credit: 0 },
        ]
  )

  const totalDebit = lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0

  const isPosted = entry?.status === 'posted'

  function updateLine(id: string, field: keyof Line, value: string | number) {
    setLines(lines.map((l) => (l.id === id ? { ...l, [field]: value } : l)))
  }

  function addLine() {
    setLines([...lines, { id: genId(), glAccountId: '', description: '', debit: 0, credit: 0 }])
  }

  function removeLine(id: string) {
    if (lines.length <= 2) return
    setLines(lines.filter((l) => l.id !== id))
  }

  async function save(status: 'draft' | 'posted') {
    setError('')
    if (!balanced) {
      setError('Entry is not balanced. Debit must equal credit.')
      return
    }
    for (const l of lines) {
      if (!l.glAccountId) {
        setError('All lines must have an account selected.')
        return
      }
      if ((l.debit || 0) > 0 && (l.credit || 0) > 0) {
        setError('A line cannot have both debit and credit amounts.')
        return
      }
    }
    setSaving(true)
    try {
      const payload = {
        entryDate,
        description,
        memo,
        status,
        lines: lines.map((l) => ({
          glAccountId: l.glAccountId,
          description: l.description,
          debit: l.debit || 0,
          credit: l.credit || 0,
        })),
      }
      const url = mode === 'edit' ? `/api/journal-entries/${entry!.id}` : '/api/journal-entries'
      const method = mode === 'edit' ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error || 'Save failed')
      }
      if (mode === 'new') {
        const created = await res.json()
        const uploadError = await uploadStaged(created.id)
        const dest = `/accounting/journal-entries/${created.id}`
        router.push(uploadError ? `${dest}?docError=1` : dest)
        router.refresh()
        return
      }
      router.push('/accounting/journal-entries')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  // Upload any documents staged on the New form, now that the JE exists.
  // Returns true if any upload failed (the JE itself is already saved — the
  // detail page's AttachmentList lets the user retry the failed files there).
  async function uploadStaged(entityId: string): Promise<boolean> {
    let failed = false
    for (const file of staged) {
      try {
        const fd = new FormData()
        fd.append('entityType', 'journal_entry')
        fd.append('entityId', entityId)
        fd.append('file', file)
        const res = await fetch('/api/attachments', { method: 'POST', body: fd })
        if (!res.ok) failed = true
      } catch {
        failed = true
      }
    }
    return failed
  }

  function addStaged(files: FileList | null) {
    if (!files || !files.length) return
    setStaged((prev) => [...prev, ...Array.from(files)])
    if (stagedInputRef.current) stagedInputRef.current.value = ''
  }

  function removeStaged(idx: number) {
    setStaged((prev) => prev.filter((_, i) => i !== idx))
  }

  async function reverse() {
    if (!entry) return
    const reason = window.prompt(
      'Reverse this posted entry? A reversing journal entry will be booked on the same date.\n\nReason (optional):',
      ''
    )
    if (reason === null) return
    setError('')
    setReversing(true)
    try {
      const res = await fetch(`/api/journal-entries/${entry.id}/reverse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to reverse entry')
      router.push(`/accounting/journal-entries/${d.id}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reverse entry')
    } finally {
      setReversing(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/accounting/journal-entries" className="text-xs text-[#0075DD] hover:underline">
            Journal Entries
          </Link>
          <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
            {mode === 'edit' ? entry!.entryNumber : 'New Journal Entry'}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/accounting/journal-entries" className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]">
            Cancel
          </Link>
          {!isPosted && (
            <>
              <button
                onClick={() => save('draft')}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] disabled:opacity-50"
              >
                Save as Draft
              </button>
              <button
                onClick={() => save('posted')}
                disabled={saving || !balanced}
                className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
              >
                {saving ? 'Posting...' : 'Post'}
              </button>
            </>
          )}
          {isPosted && mode === 'edit' && !entry?.reversal && !entry?.reversesId && (
            <button
              onClick={reverse}
              disabled={reversing}
              className="px-5 py-2 bg-white border border-[#BF2600] text-[#BF2600] text-sm font-medium rounded hover:bg-[#FDECEA] disabled:opacity-50"
            >
              {reversing ? 'Reversing…' : 'Reverse entry'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}

      {isPosted && (
        <div className="mb-4 p-3 bg-[#E3FCEF] text-[#006644] text-sm rounded">
          {entry?.reversal ? (
            <>
              This entry was reversed by{' '}
              <Link
                href={`/accounting/journal-entries/${entry.reversal.id}`}
                className="font-semibold underline"
              >
                {entry.reversal.entryNumber}
              </Link>
              .
            </>
          ) : entry?.reverses ? (
            <>
              This entry is a reversal of{' '}
              <Link
                href={`/accounting/journal-entries/${entry.reverses.id}`}
                className="font-semibold underline"
              >
                {entry.reverses.entryNumber}
              </Link>
              .
            </>
          ) : (
            'This entry has been posted and cannot be edited.'
          )}
        </div>
      )}

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-6">
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-[#001B40] mb-1">Entry Date</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              disabled={isPosted}
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm disabled:bg-[#F5F7FA]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#001B40] mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isPosted}
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm disabled:bg-[#F5F7FA]"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-[#001B40] mb-1">Memo</label>
            <textarea
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={isPosted}
              rows={2}
              className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm resize-none disabled:bg-[#F5F7FA]"
            />
          </div>
        </div>

        <table className="w-full">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Account</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Description</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981] w-32">Debit</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981] w-32">Credit</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-[#E1E6EB]">
                <td className="px-3 py-2">
                  <select
                    value={l.glAccountId}
                    onChange={(e) => updateLine(l.id, 'glAccountId', e.target.value)}
                    disabled={isPosted}
                    className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded disabled:bg-[#F5F7FA]"
                  >
                    <option value="">Select account</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountNumber} — {a.accountName}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={l.description}
                    onChange={(e) => updateLine(l.id, 'description', e.target.value)}
                    disabled={isPosted}
                    className="w-full px-2 py-1.5 text-sm border border-[#E1E6EB] rounded disabled:bg-[#F5F7FA]"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={l.debit || ''}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0
                      updateLine(l.id, 'debit', v)
                      if (v > 0) updateLine(l.id, 'credit', 0)
                    }}
                    disabled={isPosted}
                    placeholder="0.00"
                    className="w-full px-2 py-1.5 text-sm text-right border border-[#E1E6EB] rounded disabled:bg-[#F5F7FA]"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    step="0.01"
                    value={l.credit || ''}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value) || 0
                      updateLine(l.id, 'credit', v)
                      if (v > 0) updateLine(l.id, 'debit', 0)
                    }}
                    disabled={isPosted}
                    placeholder="0.00"
                    className="w-full px-2 py-1.5 text-sm text-right border border-[#E1E6EB] rounded disabled:bg-[#F5F7FA]"
                  />
                </td>
                <td className="px-3 py-2">
                  {!isPosted && lines.length > 2 && (
                    <button
                      onClick={() => removeLine(l.id)}
                      className="text-[#576981] hover:text-[#BF2600]"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#001B40] bg-[#F5F7FA]">
              <td colSpan={2} className="px-3 py-2 text-sm font-semibold text-[#001B40]">Totals</td>
              <td className="px-3 py-2 text-sm text-right font-semibold text-[#001B40]">
                {totalDebit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td className="px-3 py-2 text-sm text-right font-semibold text-[#001B40]">
                {totalCredit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>

        {!isPosted && (
          <div className="flex items-center justify-between mt-4">
            <button onClick={addLine} className="text-sm text-[#0075DD] hover:underline font-medium">
              + Add Line
            </button>
            <span
              className={`text-sm font-medium ${
                balanced ? 'text-[#006644]' : 'text-[#BF2600]'
              }`}
            >
              {balanced ? '✓ Balanced' : 'Out of balance'}
            </span>
          </div>
        )}
      </div>

      {mode === 'new' && (
        <div className="mt-6 bg-white rounded-lg border border-[#E1E6EB] p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-[#001B40]">Source Documents</h2>
            <button
              type="button"
              onClick={() => stagedInputRef.current?.click()}
              className="text-xs text-[#0075DD] hover:underline"
            >
              + Add file
            </button>
            <input
              ref={stagedInputRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => addStaged(e.target.files)}
            />
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(e) => {
              e.preventDefault()
              addStaged(e.dataTransfer.files)
            }}
            className="border-2 border-dashed border-[#E1E6EB] rounded p-3"
          >
            {staged.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-xs text-[#576981]">
                  Drop a PDF or image here to attach. Up to 25 MB each. Files upload when you save.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                {staged.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded bg-[#F5F7FA] text-[#576981] text-[10px] font-semibold">
                      {f.type === 'application/pdf' ? 'PDF' : f.type.startsWith('image/') ? 'IMG' : 'FILE'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="block truncate text-[#001B40]">{f.name}</span>
                      <div className="text-[11px] text-[#8C9BAB]">
                        {f.size < 1024 * 1024
                          ? `${(f.size / 1024).toFixed(0)} KB`
                          : `${(f.size / 1024 / 1024).toFixed(1)} MB`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStaged(i)}
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
      )}
    </div>
  )
}
