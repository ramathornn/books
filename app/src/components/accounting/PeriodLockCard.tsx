'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  initialLockedThrough: string | null
  initialLockedAt: string | null
  initialNotes: string
}

export default function PeriodLockCard({ initialLockedThrough, initialLockedAt, initialNotes }: Props) {
  const router = useRouter()
  const [lockedThrough, setLockedThrough] = useState(initialLockedThrough?.slice(0, 10) || '')
  const [notes, setNotes] = useState(initialNotes)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function save() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const res = await fetch('/api/accounting-period', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lockedThrough: lockedThrough || null,
          notes,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      setSuccess(lockedThrough ? `Books locked through ${lockedThrough}.` : 'Lock removed.')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function unlock() {
    if (!confirm('Remove the period lock? This allows backdated entries again.')) return
    setLockedThrough('')
    setSaving(true)
    try {
      await fetch('/api/accounting-period', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lockedThrough: null, notes: '' }),
      })
      setNotes('')
      setSuccess('Lock removed.')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
      <h3 className="text-base font-semibold text-[#001B40] mb-1">Period lock</h3>
      <p className="text-xs text-[#576981] mb-4">
        Once you finish month-end (reconciled, GST filed, accountant&apos;s adjustments posted), lock the period to
        prevent backdated changes. Any attempt to create or edit a transaction dated on or before the lock date
        will be rejected.
      </p>

      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
      )}
      {success && (
        <div className="mb-3 p-2 bg-[#E6F4EA] text-[#216E39] text-sm rounded">{success}</div>
      )}

      {initialLockedThrough && (
        <div className="mb-4 p-3 bg-[#F0F8FE] border border-[#0075DD] rounded text-sm">
          <strong>Currently locked through {initialLockedThrough.slice(0, 10)}.</strong>{' '}
          {initialLockedAt && (
            <span className="text-[#576981]">
              Locked on {new Date(initialLockedAt).toLocaleDateString()}.
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-[#576981] mb-1">
            Lock books through (inclusive)
          </label>
          <input
            type="date"
            value={lockedThrough}
            onChange={(e) => setLockedThrough(e.target.value)}
            className="w-full h-10 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : initialLockedThrough ? 'Update lock' : 'Lock period'}
        </button>
      </div>

      <label className="block mt-3">
        <span className="block text-xs font-medium text-[#576981] mb-1">Notes</span>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Q1 2025 closed, GST filed"
          className="w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm"
        />
      </label>

      {initialLockedThrough && (
        <div className="mt-3 pt-3 border-t border-[#E1E6EB]">
          <button onClick={unlock} disabled={saving} className="text-xs text-[#BF2600] hover:underline">
            Remove lock
          </button>
        </div>
      )}
    </div>
  )
}
