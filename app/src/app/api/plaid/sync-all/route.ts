import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { syncPlaidItem } from '@/lib/plaidSync'

// Constant-time secret check (hash both sides so length never leaks).
function secretOk(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

// Daily catch-up sync of every connected Item. Hit by a server cron with the
// shared PLAID_SYNC_SECRET (Authorization: Bearer <secret> or x-sync-secret).
// No user session — fails closed if the secret isn't configured.
export async function POST(request: NextRequest) {
  const expected = process.env.PLAID_SYNC_SECRET || ''
  const authz = request.headers.get('authorization') || ''
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : ''
  const provided = bearer || request.headers.get('x-sync-secret') || ''
  if (!expected || !secretOk(provided, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!plaid) return Response.json({ error: 'Plaid not configured' }, { status: 503 })

  const items = await prisma.plaidItem.findMany({
    where: { status: { in: ['active', 'error'] } },
    select: { id: true },
  })

  const results: Array<{ itemDbId: string; inserted?: number; error?: string }> = []
  for (const it of items) {
    try {
      const r = await syncPlaidItem(it.id)
      results.push({ itemDbId: it.id, inserted: r.inserted })
    } catch (err) {
      results.push({ itemDbId: it.id, error: err instanceof Error ? err.message : 'failed' })
    }
  }

  const totalInserted = results.reduce((s, r) => s + (r.inserted || 0), 0)
  return Response.json({ ok: true, items: results.length, totalInserted, results })
}
