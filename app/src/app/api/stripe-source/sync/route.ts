import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { reconcileStripeConnection } from '@/lib/stripeSource'

// Poll a Stripe connection's recent balance transactions and post per-charge
// draft journal entries. Idempotent: re-running never double-books (unique
// idempotency key per balance transaction). The correctness path — runnable
// from the UI ("Sync now") or a scheduler.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const connectionId = String(body.connectionId || '').trim()
  if (!connectionId) return Response.json({ error: 'connectionId required' }, { status: 400 })

  const sinceDays = Number.isFinite(body.sinceDays) ? Number(body.sinceDays) : undefined

  try {
    const result = await reconcileStripeConnection(connectionId, { sinceDays })
    return Response.json({ result })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Sync failed' }, { status: 400 })
  }
}
