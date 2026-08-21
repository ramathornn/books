'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  token: string
}

type Mode = 'idle' | 'accept-form' | 'decline-confirm'

export default function EstimateActions({ token }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('idle')
  const [loading, setLoading] = useState(false)
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState('')

  async function submitResponse(status: 'accepted' | 'declined') {
    setError('')
    setLoading(true)
    try {
      const body: Record<string, string> = { token, status }
      if (status === 'accepted') {
        body.signerName = signerName.trim()
        body.signerEmail = signerEmail.trim()
      }
      const res = await fetch('/api/estimates/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to submit your response. Please try again.')
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'idle') {
    return (
      <div className="mb-6 flex items-center justify-center gap-4">
        <button
          onClick={() => {
            setError('')
            setMode('accept-form')
          }}
          className="px-6 py-3 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-semibold rounded-md shadow-sm transition-colors"
        >
          Accept Estimate
        </button>
        <button
          onClick={() => {
            setError('')
            setMode('decline-confirm')
          }}
          className="px-6 py-3 bg-white hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-md border border-gray-300 shadow-sm transition-colors"
        >
          Decline Estimate
        </button>
      </div>
    )
  }

  if (mode === 'decline-confirm') {
    return (
      <div className="mb-6 rounded-lg bg-white shadow-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Decline this estimate?
        </h2>
        <p className="text-sm text-gray-600 mb-4">
          The sender will be notified that you have declined this estimate.
        </p>
        {error && (
          <div className="mb-4 text-sm text-[#BF2600]">{error}</div>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setMode('idle')}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => submitResponse('declined')}
            disabled={loading}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#BF2600] hover:bg-[#9e1f00] rounded-md shadow-sm transition-colors disabled:opacity-50"
          >
            {loading ? 'Submitting...' : 'Decline Estimate'}
          </button>
        </div>
      </div>
    )
  }

  // mode === 'accept-form'
  const canSubmit =
    signerName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim()) &&
    agreed &&
    !loading

  return (
    <div className="mb-6 rounded-lg bg-white shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-2">
        Accept &amp; Sign Off
      </h2>
      <p className="text-sm text-gray-600 mb-4">
        Please enter your full name and email to accept this estimate. This
        will be recorded as your electronic signature.
      </p>
      <div className="space-y-4">
        <div>
          <label
            htmlFor="signer-name"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Full Name
          </label>
          <input
            id="signer-name"
            type="text"
            autoComplete="name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            placeholder="Jane Doe"
            maxLength={200}
            disabled={loading}
          />
        </div>
        <div>
          <label
            htmlFor="signer-email"
            className="block text-xs font-medium text-gray-700 mb-1"
          >
            Email
          </label>
          <input
            id="signer-email"
            type="email"
            autoComplete="email"
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            placeholder="you@example.com"
            maxLength={200}
            disabled={loading}
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            disabled={loading}
            className="mt-0.5 rounded border-gray-300 text-[#2FA84F] focus:ring-[#2FA84F]"
          />
          <span>
            I, <strong>{signerName.trim() || 'the signer named above'}</strong>,
            accept this estimate and agree to proceed.
          </span>
        </label>
        {error && (
          <div className="text-sm text-[#BF2600]">{error}</div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={() => setMode('idle')}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => submitResponse('accepted')}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Submitting...' : 'Accept Estimate'}
          </button>
        </div>
        <p className="text-xs text-gray-400">
          By accepting, you acknowledge that your name, email, IP address and
          the time of acceptance will be recorded as your electronic signature.
        </p>
      </div>
    </div>
  )
}
