// Shared plumbing for /api/forecasts/* route handlers.
import 'server-only'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import type { ZodType } from 'zod'

/** Reads: bearer token (headless agents) OR session. */
export async function readAuth(request: NextRequest): Promise<Response | null> {
  const authed = await requireApiAuth(request)
  return authed.ok ? null : Response.json({ error: 'Unauthorized' }, { status: authed.status })
}

/**
 * Writes: bearer token (headless agents) OR owner session. DELETE stays
 * session-only (the proxy also keeps DELETE behind the session redirect).
 * Accountant sessions are read-only.
 */
export async function writeAuth(request: NextRequest): Promise<Response | null> {
  if (request.method !== 'DELETE') {
    const authed = await requireApiAuth(request)
    if (authed.ok && authed.via === 'bearer') return null
  }
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.user.role === 'accountant') return Response.json({ error: 'Read-only access', code: 'READ_ONLY_ROLE' }, { status: 403 })
  return null
}

export async function scenarioExists(id: string): Promise<boolean> {
  const s = await prisma.forecastScenario.findUnique({ where: { id }, select: { id: true } })
  return !!s
}

export const notFound = (what = 'Scenario') => Response.json({ error: `${what} not found` }, { status: 404 })

export async function parseBody<T>(request: NextRequest, schema: ZodType<T>): Promise<{ data: T } | { error: Response }> {
  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return { error: Response.json({ error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 }) }
  }
  return { data: parsed.data }
}

export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002'
}
