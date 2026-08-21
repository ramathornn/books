import crypto from 'node:crypto'
import { auth } from '@/lib/auth'

// Shared auth for machine-callable file endpoints. Passes if EITHER a valid
// `Authorization: Bearer <token>` matches FILES_API_TOKEN (constant-time, on the
// sha256 of each side so length never leaks), OR a NextAuth session is present.
//
// The bearer check fails closed: if FILES_API_TOKEN is unset/too weak it never
// matches, so the only way in is a real session.

export type ApiAuthResult =
  | { ok: true; via: 'session' | 'bearer' }
  | { ok: false; status: number }

function tokensMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export async function requireApiAuth(request: Request): Promise<ApiAuthResult> {
  // (a) Bearer token — for headless callers (scripts, agents).
  const expected = process.env.FILES_API_TOKEN
  if (expected && expected.length >= 16) {
    const authz = request.headers.get('authorization') || ''
    const bearer = authz.toLowerCase().startsWith('bearer ')
      ? authz.slice(7).trim()
      : ''
    if (bearer && tokensMatch(bearer, expected)) {
      return { ok: true, via: 'bearer' }
    }
  }

  // (b) Interactive NextAuth session.
  const session = await auth()
  if (session?.user) {
    return { ok: true, via: 'session' }
  }

  return { ok: false, status: 401 }
}
