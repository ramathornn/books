'use client'

import { useEffect, useState } from 'react'
import { registerPasskey, PasskeyCancelledError } from '@/lib/webauthnClient'

export default function PasskeyEnrollPrompt() {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    // Only offer if the browser supports platform passkeys.
    if (
      typeof window === 'undefined' ||
      !window.PublicKeyCredential
    ) {
      return
    }
    ;(async () => {
      try {
        const res = await fetch('/api/auth/webauthn/status')
        if (!res.ok) return
        const data = await res.json()
        if (active && !data.hasPasskey && !data.promptDismissed) {
          setShow(true)
        }
      } catch {
        // ignore
      }
    })()
    return () => {
      active = false
    }
  }, [])

  async function handleAdd() {
    setError('')
    setBusy(true)
    try {
      await registerPasskey()
      setShow(false)
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setBusy(false)
        return
      }
      setError(err instanceof Error ? err.message : 'Could not add passkey.')
      setBusy(false)
    }
  }

  async function handleDismiss() {
    setShow(false)
    try {
      await fetch('/api/auth/webauthn/dismiss-prompt', { method: 'POST' })
    } catch {
      // ignore
    }
  }

  if (!show) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full p-6">
        <div className="flex justify-center mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#E9F6EE]">
            <svg
              className="w-6 h-6 text-[#2FA84F]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
              />
            </svg>
          </div>
        </div>

        <h3 className="text-lg font-semibold text-gray-900 text-center mb-1">
          Add Face ID sign-in?
        </h3>
        <p className="text-sm text-gray-500 text-center mb-5">
          Use Face ID, Touch ID, or your device PIN to sign in next time —
          faster and more secure than a password.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
            {error}
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={busy}
          className="w-full py-2.5 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
        >
          {busy ? 'Waiting for device...' : 'Add a Passkey'}
        </button>
        <button
          onClick={handleDismiss}
          disabled={busy}
          className="w-full py-2 mt-2 text-sm text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-50"
        >
          Don&apos;t ask me again
        </button>
      </div>
    </div>
  )
}
