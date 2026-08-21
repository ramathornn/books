import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { matchTransaction, type MatchTarget } from '@/lib/bankMatch'

// POST /api/banking/match — headless match of a bank transaction to an existing
// Invoice (creating a Payment), recorded Payment (clearing undeposited funds),
// or Bill (A/P). Authenticates via Bearer token OR session (requireApiAuth) so
// agents/scripts can call it; the posting logic lives in src/lib/bankMatch.ts
// (matchTransaction) and is shared with the in-app match route.
//
// Body (JSON): { transaction_id, invoice_id? | payment_id? | bill_id? }
//   Exactly one of invoice_id / payment_id / bill_id must be present.
//
// Idempotent: a transaction that is already posted returns 409.
export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const transactionId = String(body.transaction_id || '').trim()
  if (!transactionId) {
    return Response.json({ error: 'transaction_id required' }, { status: 400 })
  }

  // Resolve the target: exactly one of invoice_id / payment_id / bill_id.
  const candidates: Array<{ target: MatchTarget; id: string }> = []
  const invoiceId = String(body.invoice_id || '').trim()
  const paymentId = String(body.payment_id || '').trim()
  const billId = String(body.bill_id || '').trim()
  if (invoiceId) candidates.push({ target: 'invoice', id: invoiceId })
  if (paymentId) candidates.push({ target: 'payment', id: paymentId })
  if (billId) candidates.push({ target: 'bill', id: billId })

  if (candidates.length === 0) {
    return Response.json(
      { error: 'Provide exactly one of invoice_id, payment_id, or bill_id' },
      { status: 400 }
    )
  }
  if (candidates.length > 1) {
    return Response.json(
      { error: 'Provide only one of invoice_id, payment_id, or bill_id' },
      { status: 400 }
    )
  }

  const { target, id: targetId } = candidates[0]

  const result = await matchTransaction({
    txId: transactionId,
    target,
    targetId,
    fxGlAccountId: body.fx_gl_account_id ? String(body.fx_gl_account_id) : undefined,
  })

  if (!result.ok) {
    // "Already posted" is an idempotency signal, not a hard error → 409.
    const status = result.error === 'Already posted' ? 409 : result.status
    return Response.json({ error: result.error }, { status })
  }

  const payload: Record<string, unknown> = {
    ok: true,
    journal_entry_id: result.journalEntryId,
  }
  if (result.paymentId) payload.payment_id = result.paymentId
  return Response.json(payload)
}
