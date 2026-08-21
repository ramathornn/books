import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { matchTransaction, type MatchTarget } from '@/lib/bankMatch'

// Match a bank transaction to an existing Invoice (creating a Payment), an
// Expense, a recorded Payment already cleared to undeposited funds, or a Bill
// (A/P). The posting logic lives in src/lib/bankMatch.ts (matchTransaction).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const target = String(body.target || '') as MatchTarget
  const targetId = String(body.targetId || '')
  if (!target || !targetId) return Response.json({ error: 'target and targetId required' }, { status: 400 })

  const result = await matchTransaction({
    txId: id,
    target,
    targetId,
    fxGlAccountId: body.fxGlAccountId ? String(body.fxGlAccountId) : undefined,
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  const payload: Record<string, unknown> = { ok: true, journalEntryId: result.journalEntryId }
  if (result.paymentId) payload.paymentId = result.paymentId
  return Response.json(payload)
}
