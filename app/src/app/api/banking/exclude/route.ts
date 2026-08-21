import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { excludeTransaction } from '@/lib/bankExclude'

// POST /api/banking/exclude — headless "exclude" of a pending bank transaction.
//
// Body (JSON): { transaction_id: string, reason?: string }
//
// Marks a pending bank transaction as 'excluded' (neither income nor expense:
// internal line, duplicate, or noise) via the shared excludeTransaction helper.
// Idempotent: an already-excluded transaction returns 200 { ok: true }. A posted
// transaction is rejected (400) — move it back to Pending first.
export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  let body: { transaction_id?: unknown; reason?: unknown }
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Expected JSON body with transaction_id' },
      { status: 400 }
    )
  }

  const txId = typeof body.transaction_id === 'string' ? body.transaction_id.trim() : ''
  if (!txId) {
    return Response.json({ error: 'transaction_id is required' }, { status: 400 })
  }
  const reason = typeof body.reason === 'string' ? body.reason : undefined

  const result = await excludeTransaction(txId, reason)
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  return Response.json({ ok: true })
}
