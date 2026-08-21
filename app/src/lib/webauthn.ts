import 'server-only'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'

export const RP_NAME = 'Books'

export const REG_CHALLENGE_COOKIE = 'webauthn_reg_challenge'
export const AUTH_CHALLENGE_COOKIE = 'webauthn_auth_challenge'

// Derive the Relying Party ID (hostname) and expected origin from the request
// so the same code works in local dev (localhost) and in production.
export function getRpId(request: NextRequest): string {
  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  return host.split(':')[0] || 'localhost'
}

export function getOrigin(request: NextRequest): string {
  const origin = request.headers.get('origin')
  if (origin) return origin
  const proto = request.headers.get('x-forwarded-proto') || 'http'
  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  return `${proto}://${host}`
}

export async function setChallengeCookie(name: string, challenge: string) {
  const store = await cookies()
  store.set(name, challenge, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 300,
  })
}

export async function readChallengeCookie(name: string): Promise<string | null> {
  const store = await cookies()
  return store.get(name)?.value ?? null
}

export async function clearChallengeCookie(name: string) {
  const store = await cookies()
  store.delete(name)
}
