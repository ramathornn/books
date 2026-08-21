'use client'

import { useState, useEffect } from 'react'

export default function TwoFactorSettings() {
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [setupMode, setSetupMode] = useState(false)
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [secretVisible, setSecretVisible] = useState(false)

  useEffect(() => {
    fetchStatus()
  }, [])

  async function fetchStatus() {
    try {
      const res = await fetch('/api/auth/totp/status')
      if (res.ok) {
        const data = await res.json()
        setTotpEnabled(data.enabled)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  async function startSetup() {
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      const res = await fetch('/api/auth/totp')
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start setup')
      }
      const data = await res.json()
      setQrCode(data.qrCode)
      setSecret(data.secret)
      setSetupMode(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setSaving(false)
    }
  }

  async function verifyAndEnable() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/auth/totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Verification failed')
      }
      setTotpEnabled(true)
      setSetupMode(false)
      setQrCode('')
      setSecret('')
      setVerifyCode('')
      setSuccess('Two-factor authentication has been enabled.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setSaving(false)
    }
  }

  async function disable2FA() {
    setError('')
    setSaving(true)
    try {
      const res = await fetch('/api/auth/totp', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || 'Failed to disable 2FA')
      }
      setTotpEnabled(false)
      setShowDisable(false)
      setDisableCode('')
      setSuccess('Two-factor authentication has been disabled.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disable')
    } finally {
      setSaving(false)
    }
  }

  function cancelSetup() {
    setSetupMode(false)
    setQrCode('')
    setSecret('')
    setVerifyCode('')
    setError('')
  }

  if (loading) {
    return (
      <div className="bg-white rounded-sm shadow-md p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Two-Factor Authentication</h2>
        <div className="animate-pulse h-10 bg-gray-100 rounded" />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-sm shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Two-Factor Authentication
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

      {/* Status indicator */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-2.5 h-2.5 rounded-full ${totpEnabled ? 'bg-green-500' : 'bg-gray-300'}`} />
        <span className="text-sm text-gray-700">
          {totpEnabled ? 'Enabled' : 'Not enabled'}
        </span>
      </div>

      {/* Not enabled — show setup button */}
      {!totpEnabled && !setupMode && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Add an extra layer of security by requiring a code from your authenticator app when signing in.
          </p>
          <button
            onClick={startSetup}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors disabled:opacity-50"
          >
            {saving ? 'Setting up...' : 'Set Up Two-Factor Authentication'}
          </button>
        </div>
      )}

      {/* Setup mode — show QR code and verification */}
      {setupMode && (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-gray-600 mb-3">
              Scan this QR code with your authenticator app (Google Authenticator, Authy, 1Password, etc.):
            </p>
            {qrCode && (
              <div className="flex justify-center mb-4">
                <img
                  src={qrCode}
                  alt="TOTP QR Code"
                  className="w-48 h-48 border border-gray-200 rounded-lg"
                />
              </div>
            )}
          </div>

          {/* Manual entry secret */}
          <div>
            <p className="text-xs text-gray-500 mb-1">
              Can't scan? Enter this key manually:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-xs font-mono break-all">
                {secretVisible ? secret : '••••••••••••••••••••••••••••••••'}
              </code>
              <button
                type="button"
                onClick={() => setSecretVisible(!secretVisible)}
                className="px-2 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded"
              >
                {secretVisible ? 'Hide' : 'Show'}
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(secret)}
                className="px-2 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded"
              >
                Copy
              </button>
            </div>
          </div>

          {/* Verify code */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Enter the 6-digit code from your app to verify:
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                autoComplete="one-time-code"
                className="w-36 px-3 py-2 border border-gray-300 rounded-md text-sm text-center tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-[#2FA84F] focus:border-[#2FA84F]"
              />
              <button
                onClick={verifyAndEnable}
                disabled={saving || verifyCode.length !== 6}
                className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors disabled:opacity-50"
              >
                {saving ? 'Verifying...' : 'Verify & Enable'}
              </button>
              <button
                onClick={cancelSetup}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enabled — show disable option */}
      {totpEnabled && !showDisable && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Your account is protected with two-factor authentication. You will be asked for a code from your authenticator app each time you sign in.
          </p>
          <button
            onClick={() => { setShowDisable(true); setError(''); setSuccess('') }}
            className="px-4 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50 transition-colors"
          >
            Disable Two-Factor Authentication
          </button>
        </div>
      )}

      {/* Disable confirmation */}
      {totpEnabled && showDisable && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-700 mb-3">
            Enter your current authenticator code to confirm disabling 2FA:
          </p>
          <div className="flex gap-3">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoComplete="one-time-code"
              className="w-36 px-3 py-2 border border-gray-300 rounded-md text-sm text-center tracking-[0.3em] font-mono focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
            />
            <button
              onClick={disable2FA}
              disabled={saving || disableCode.length !== 6}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50"
            >
              {saving ? 'Disabling...' : 'Confirm Disable'}
            </button>
            <button
              onClick={() => { setShowDisable(false); setDisableCode(''); setError('') }}
              className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
