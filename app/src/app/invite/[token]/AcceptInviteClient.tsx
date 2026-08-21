'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass =
  'w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#2FA84F] focus:border-[#2FA84F]'

export default function AcceptInviteClient({
  token,
  email,
  role,
}: {
  token: string
  email: string
  role: string
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/users/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not accept the invite.')
        return
      }
      setDone(true)
      setTimeout(() => router.push('/login'), 1500)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="text-center">
        <p className="text-sm text-gray-700">Account created. Taking you to sign in…</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-sm text-gray-600">
        You&apos;ve been invited as <span className="font-medium">{email}</span>
        {role === 'accountant' ? (
          <> with <span className="font-medium">read-only accountant</span> access.</>
        ) : (
          <> with <span className="font-medium">full owner</span> access.</>
        )}{' '}
        Set up your account below.
      </p>

      {error && (
        <div className="p-3 bg-[#FFEBE6] text-[#BF2600] text-sm rounded-md">{error}</div>
      )}

      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Your name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className={inputClass}
          required
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          className={inputClass}
          required
        />
        <p className="mt-1 text-xs text-gray-400">At least 12 characters.</p>
      </div>

      <div>
        <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
          Confirm password
        </label>
        <input
          id="confirm"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          minLength={12}
          className={inputClass}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 bg-[#2FA84F] text-white text-sm font-medium rounded-md hover:bg-[#268a42] disabled:opacity-60"
      >
        {loading ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  )
}
