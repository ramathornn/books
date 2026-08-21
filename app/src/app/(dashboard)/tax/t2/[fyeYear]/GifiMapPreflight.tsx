'use client'

import { useMemo, useState } from 'react'

export interface GifiMapAccount {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
  detailType: string
  gifiCode: string | null
  gifiLabel: string | null
  incomeNature: string | null
  suggestedCode: string | null
  suggestedLabel: string | null
  suggestionRequiresConfirm: boolean
  incomeNatureApplicable: boolean
  incomeNatureRequired: boolean
}

type ApplyFn = (
  updates: Array<{ id: string; gifiCode?: string | null; incomeNature?: string | null; confirm?: boolean }>,
) => Promise<{ requiresConfirm?: string[]; message?: string } | undefined>

const NATURE_OPTIONS = [
  { value: 'active', label: 'Active business' },
  { value: 'investment', label: 'Investment (passive)' },
  { value: 'capitalGains', label: 'Capital gains' },
]

/**
 * GIFI mapping pre-flight — the builder's first guided step. Lists every account
 * that still needs a GIFI code (with a generic keyword-suggested default + a
 * bulk-apply), and forces an incomeNature classification on passive-looking
 * income/expense accounts (Other Income / interest / dividend / rental / gain).
 * Amortization (8670) and meals (8523) suggestions require explicit confirmation.
 */
export default function GifiMapPreflight({
  accounts,
  unmapped,
  untaggedPassive,
  onApply,
}: {
  accounts: GifiMapAccount[]
  unmapped: number
  untaggedPassive: number
  onApply: ApplyFn
}) {
  const [open, setOpen] = useState(unmapped > 0 || untaggedPassive > 0)
  const [drafts, setDrafts] = useState<Record<string, { gifiCode?: string; incomeNature?: string }>>({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const needsAttention = useMemo(
    () => accounts.filter((a) => !a.gifiCode || (a.incomeNatureRequired && !a.incomeNature)),
    [accounts],
  )

  function setDraft(id: string, patch: { gifiCode?: string; incomeNature?: string }) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  async function applyAllSuggestions() {
    // Apply every non-confirm-required suggestion at once; confirm-required ones
    // (8670/8523) are left for the user to apply explicitly with the checkbox.
    const updates = accounts
      .filter((a) => !a.gifiCode && a.suggestedCode && !a.suggestionRequiresConfirm)
      .map((a) => ({ id: a.id, gifiCode: a.suggestedCode! }))
    if (updates.length === 0) {
      setNote('No auto-applicable suggestions (remaining accounts need manual mapping or confirmation).')
      return
    }
    setBusy(true)
    try {
      const res = await onApply(updates)
      setNote(res?.message ?? `Applied ${updates.length} suggestion(s).`)
    } finally {
      setBusy(false)
    }
  }

  async function applyDrafts() {
    const updates: Array<{ id: string; gifiCode?: string | null; incomeNature?: string | null; confirm?: boolean }> = []
    for (const [id, d] of Object.entries(drafts)) {
      const u: { id: string; gifiCode?: string | null; incomeNature?: string | null; confirm?: boolean } = { id }
      if (d.gifiCode !== undefined && d.gifiCode !== '') {
        u.gifiCode = d.gifiCode
        u.confirm = true // explicit user choice in the field
      }
      if (d.incomeNature !== undefined && d.incomeNature !== '') u.incomeNature = d.incomeNature
      if (u.gifiCode !== undefined || u.incomeNature !== undefined) updates.push(u)
    }
    if (updates.length === 0) {
      setNote('Nothing to apply — enter a code or classification first.')
      return
    }
    setBusy(true)
    try {
      const res = await onApply(updates)
      setDrafts({})
      setNote(res?.message ?? `Applied ${updates.length} change(s).`)
    } finally {
      setBusy(false)
    }
  }

  const ok = unmapped === 0 && untaggedPassive === 0

  return (
    <div className="rounded-lg border border-[#E5EAF1] bg-white">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div>
          <div className="text-[#001B40] font-medium">1. Map your chart to GIFI</div>
          <div className="text-xs text-[#8595A8] mt-0.5">
            {ok ? (
              <span className="text-[#256A3A]">All accounts mapped and classified.</span>
            ) : (
              <span className="text-[#9B2C2C]">
                {unmapped} unmapped{unmapped && untaggedPassive ? ' · ' : ''}
                {untaggedPassive ? `${untaggedPassive} passive account(s) need a nature` : ''}
              </span>
            )}
          </div>
        </div>
        <svg className={`w-4 h-4 text-[#8595A8] transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={applyAllSuggestions}
              disabled={busy}
              className="px-3 py-1.5 rounded-md bg-[#0075DD] text-white text-sm font-medium hover:bg-[#0063BD] disabled:opacity-50"
            >
              Apply suggested codes
            </button>
            <button
              onClick={applyDrafts}
              disabled={busy}
              className="px-3 py-1.5 rounded-md border border-[#D9E1EC] text-sm text-[#576981] hover:bg-[#F4F7FB] disabled:opacity-50"
            >
              Save my edits
            </button>
          </div>
          {note ? <div className="text-xs text-[#8A6D1B]">{note}</div> : null}

          {needsAttention.length === 0 ? (
            <div className="text-sm text-[#256A3A]">Every active account has a GIFI code and (where needed) an income nature.</div>
          ) : (
            <div className="rounded-md border border-[#E5EAF1] overflow-hidden">
              <div className="grid grid-cols-[1fr_8rem_8rem] gap-2 px-3 py-2 bg-[#FBFCFE] border-b border-[#E5EAF1] text-xs font-medium text-[#576981]">
                <div>Account</div>
                <div>GIFI code</div>
                <div>Income nature</div>
              </div>
              {needsAttention.map((a) => {
                const d = drafts[a.id] ?? {}
                return (
                  <div key={a.id} className="grid grid-cols-[1fr_8rem_8rem] gap-2 px-3 py-2.5 border-b border-[#F1F4F8] last:border-0 items-start">
                    <div>
                      <div className="text-sm text-[#001B40]">
                        <span className="font-mono text-xs text-[#8595A8]">{a.accountNumber}</span> {a.accountName}
                      </div>
                      {!a.gifiCode && a.suggestedCode ? (
                        <div className="text-xs text-[#8595A8]">
                          Suggested {a.suggestedCode} — {a.suggestedLabel}
                          {a.suggestionRequiresConfirm ? ' (confirm)' : ''}
                        </div>
                      ) : null}
                      {a.incomeNatureRequired && !a.incomeNature ? (
                        <div className="text-xs text-[#9B2C2C]">Looks passive — classify it.</div>
                      ) : null}
                    </div>
                    <div>
                      {a.gifiCode ? (
                        <div className="text-sm font-mono text-[#256A3A] py-1.5">{a.gifiCode}</div>
                      ) : (
                        <input
                          value={d.gifiCode ?? a.suggestedCode ?? ''}
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="0000"
                          onChange={(e) => setDraft(a.id, { gifiCode: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                          className="w-full rounded-md border border-[#D9E1EC] px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30"
                        />
                      )}
                    </div>
                    <div>
                      {a.incomeNatureApplicable ? (
                        <select
                          value={d.incomeNature ?? a.incomeNature ?? (a.incomeNatureRequired ? '' : 'active')}
                          onChange={(e) => setDraft(a.id, { incomeNature: e.target.value })}
                          className="w-full rounded-md border border-[#D9E1EC] px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0075DD]/30"
                        >
                          {a.incomeNatureRequired ? <option value="">Choose…</option> : null}
                          {NATURE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="text-xs text-[#8595A8] py-1.5">—</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="text-xs text-[#8595A8]">
            Operating income defaults to active business. Only passive-looking accounts (Other Income, interest,
            dividend, rental, gains) force a choice — and when there is none, ART / RDTOH / Part IV / the dividend
            refund all correctly compute to $0.
          </p>
        </div>
      ) : null}
    </div>
  )
}
