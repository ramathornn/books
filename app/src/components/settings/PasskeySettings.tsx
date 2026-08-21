'use client'

import { useState, useEffect } from 'react'
import { registerPasskey, PasskeyCancelledError } from '@/lib/webauthnClient'

interface Passkey {
  id: string
  deviceName: string
  createdAt: string
  lastUsedAt: string | null
}

function formatDate(d: string | null): string {
  if (!d) return 'Never'
  const dt = new Date(d)
  const month = dt.toLocaleString('en-US', { month: 'short' })
  return `${month} ${dt.getDate()}, ${dt.getFullYear()}`
}

export default function PasskeySettings() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetchPasskeys()
  }, [])

  async function fetchPasskeys() {
    try {
      const res = await fetch('/api/auth/webauthn/passkeys')
      if (res.ok) {
        const data = await res.json()
        setPasskeys(data.passkeys)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function addPasskey() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      await registerPasskey()
      setSuccess('Passkey added. You can now sign in with Face ID.')
      await fetchPasskeys()
    } catch (err) {
      if (!(err instanceof PasskeyCancelledError)) {
        setError(err instanceof Error ? err.message : 'Could not add passkey.')
      }
    } finally {
      setSaving(false)
    }
  }

  async function deletePasskey(id: string) {
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`/api/auth/webauthn/passkeys/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Could not remove passkey.')
      }
      setPasskeys((prev) => prev.filter((p) => p.id !== id))
      setSuccess('Passkey removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove passkey.')
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-sm shadow-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Face ID &amp; Passkeys
        </h2>
        <div className="animate-pulse h-10 bg-gray-100 rounded" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-sm shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Face ID &amp; Passkeys
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm rounded-md">
          {success}
        </div>
      )}

      <p className="text-sm text-gray-500 mb-4">
        Add a passkey to sign in with Face ID, Touch ID, or your device PIN
        instead of typing your password.
      </p>

      {passkeys.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 border border-gray-100 rounded-md">
          {passkeys.map((pk) => (
            <li
              key={pk.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {pk.deviceName}
                </div>
                <div className="text-xs text-gray-500">
                  Added {formatDate(pk.createdAt)} · Last used{' '}
                  {formatDate(pk.lastUsedAt)}
                </div>
              </div>
              <button
                onClick={() => deletePasskey(pk.id)}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={addPasskey}
        disabled={saving}
        className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors disabled:opacity-50"
      >
        {saving ? 'Waiting for device...' : 'Add a Passkey'}
      </button>
    </div>
  )
}
