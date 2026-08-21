'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Copy / revoke controls for a pending sign-in invite (team-members table row).
export default function InviteActions({ inviteId, token }: { inviteId: string; token: string }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard unavailable
    }
  }

  async function revoke() {
    setBusy(true)
    try {
      await fetch(`/api/users/invite/${inviteId}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2 ml-2">
      <button type="button" onClick={copy} className="text-xs text-[#0075DD] hover:underline">
        {copied ? 'Copied!' : 'Copy link'}
      </button>
      <button
        type="button"
        onClick={revoke}
        disabled={busy}
        className="text-xs text-[#BF2600] hover:underline disabled:opacity-50"
      >
        Revoke
      </button>
    </span>
  )
}
