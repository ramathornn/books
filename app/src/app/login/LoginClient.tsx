'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { signInWithPasskey, PasskeyCancelledError } from '@/lib/webauthnClient'

interface LoginProps {
  companyName: string
  companyLegalName: string
}

function LoginForm({ companyName, companyLegalName }: LoginProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials')
  const [passkeyLoading, setPasskeyLoading] = useState(false)

  async function handlePasskey() {
    setError('')
    setPasskeyLoading(true)
    try {
      const { email: pkEmail, token } = await signInWithPasskey()

      const result = await signIn('credentials', {
        email: pkEmail,
        webauthnToken: token,
        redirect: false,
      })

      if (result?.error) {
        throw new Error('Passkey sign-in failed.')
      }

      router.push(callbackUrl)
      router.refresh()
    } catch (err) {
      if (err instanceof PasskeyCancelledError) {
        setPasskeyLoading(false)
        return
      }
      setError(err instanceof Error ? err.message : 'Passkey sign-in failed.')
      setPasskeyLoading(false)
    }
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!email.trim() || !password) {
      setError('Please enter your email and password.')
      return
    }

    setLoading(true)
    try {
      // Check password + TOTP status in one call
      const checkRes = await fetch('/api/auth/totp/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const checkData = await checkRes.json()

      if (!checkData.passwordValid) {
        throw new Error('Invalid email or password.')
      }

      if (checkData.totpRequired) {
        // Password is correct, but TOTP is needed
        setStep('totp')
        setLoading(false)
        return
      }

      // No TOTP — sign in directly
      const result = await signIn('credentials', {
        email,
        password,
        totpCode: '',
        redirect: false,
      })

      if (result?.error) {
        throw new Error('Invalid email or password.')
      }

      router.push(callbackUrl)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (totpCode.length !== 6) {
      setError('Please enter a 6-digit code.')
      return
    }

    setLoading(true)
    try {
      const result = await signIn('credentials', {
        email,
        password,
        totpCode,
        redirect: false,
      })

      if (result?.error) {
        setError('Invalid authentication code. Please try again.')
        setTotpCode('')
        setLoading(false)
        return
      }

      router.push(callbackUrl)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed.')
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setStep('credentials')
    setTotpCode('')
    setError('')
  }

  return (
    <div className="bg-white rounded-lg shadow-xl p-8">
      {/* Logo */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-black text-[#1A3353] tracking-tight">
          {companyName.toUpperCase()}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{companyLegalName}</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-[#FFEBE6] text-[#BF2600] text-sm rounded-md">
          {error}
        </div>
      )}

      {step === 'credentials' ? (
        <form onSubmit={handleCredentials} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
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
              placeholder="Enter your password"
              autoComplete="current-password"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing In...' : 'Sign In'}
          </button>

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <button
            type="button"
            onClick={handlePasskey}
            disabled={passkeyLoading || loading}
            className="w-full py-2.5 flex items-center justify-center gap-2 border border-gray-300 text-[#1A3353] text-sm font-semibold rounded-md hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            {passkeyLoading ? 'Waiting for Face ID...' : 'Sign in with Face ID'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleTotp} className="space-y-4">
          <div className="text-center mb-2">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 mb-3">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">
              Enter the 6-digit code from your authenticator app.
            </p>
          </div>

          <div>
            <label htmlFor="totpCode" className="block text-sm font-medium text-gray-700 mb-1">
              Authentication Code
            </label>
            <input
              id="totpCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoComplete="one-time-code"
              autoFocus
              className="w-full px-3 py-2.5 border border-gray-300 rounded-md text-sm text-center tracking-[0.5em] font-mono text-lg focus:outline-none focus:ring-2 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || totpCode.length !== 6}
            className="w-full py-2.5 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-semibold rounded-md transition-colors disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Verify'}
          </button>

          <button
            type="button"
            onClick={handleBack}
            className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Back to login
          </button>
        </form>
      )}
    </div>
  )
}

export default function LoginPage({ companyName, companyLegalName }: LoginProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A3353] to-[#2d5a8e] px-4">
      <div className="w-full max-w-md">
        <Suspense fallback={
          <div className="bg-white rounded-lg shadow-xl p-8">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-black text-[#1A3353] tracking-tight">
                {companyName.toUpperCase()}
              </h1>
              <p className="text-sm text-gray-500 mt-1">{companyLegalName}</p>
            </div>
            <div className="text-center text-sm text-gray-500">Loading...</div>
          </div>
        }>
          <LoginForm companyName={companyName} companyLegalName={companyLegalName} />
        </Suspense>
      </div>
    </div>
  )
}
