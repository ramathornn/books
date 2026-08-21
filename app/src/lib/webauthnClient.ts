import { startRegistration, startAuthentication } from '@simplewebauthn/browser'

export class PasskeyCancelledError extends Error {
  constructor() {
    super('Passkey prompt was cancelled.')
    this.name = 'PasskeyCancelledError'
  }
}

function isCancel(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'NotAllowedError' || err.name === 'AbortError')
  )
}

// Register a new passkey for the currently signed-in user.
export async function registerPasskey(): Promise<void> {
  const optionsRes = await fetch('/api/auth/webauthn/register/options', {
    method: 'POST',
  })
  if (!optionsRes.ok) {
    const data = await optionsRes.json().catch(() => ({}))
    throw new Error(data.error || 'Could not start passkey setup.')
  }
  const options = await optionsRes.json()

  let attResp
  try {
    attResp = await startRegistration(options)
  } catch (err) {
    if (isCancel(err)) throw new PasskeyCancelledError()
    throw new Error('Your device could not create a passkey.')
  }

  const verifyRes = await fetch('/api/auth/webauthn/register/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(attResp),
  })
  const verifyData = await verifyRes.json().catch(() => ({}))
  if (!verifyRes.ok || !verifyData.verified) {
    throw new Error(verifyData.error || 'Passkey could not be saved.')
  }
}

// Authenticate with a discoverable passkey. Returns the one-time token + email
// to hand off to NextAuth's credentials sign-in.
export async function signInWithPasskey(): Promise<{
  email: string
  token: string
}> {
  const optionsRes = await fetch('/api/auth/webauthn/authenticate/options', {
    method: 'POST',
  })
  if (!optionsRes.ok) {
    throw new Error('Could not start passkey sign-in.')
  }
  const options = await optionsRes.json()

  let asseResp
  try {
    asseResp = await startAuthentication(options)
  } catch (err) {
    if (isCancel(err)) throw new PasskeyCancelledError()
    throw new Error('No passkey was available on this device.')
  }

  const verifyRes = await fetch('/api/auth/webauthn/authenticate/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(asseResp),
  })
  const verifyData = await verifyRes.json().catch(() => ({}))
  if (!verifyRes.ok || !verifyData.ok) {
    throw new Error(verifyData.error || 'Passkey sign-in failed.')
  }

  return { email: verifyData.email, token: verifyData.token }
}
