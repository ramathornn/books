import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { matchTransactionSplit, type SplitAllocation } from '@/lib/bankMatchSplit'

// POST /api/banking/match-split — settle ONE money-in deposit across MULTIPLE
// invoices in a single posted JE, with an optional fee gap expensed.
//
// Body (JSON):
//   transaction_id   (string, required)
//   allocations      (array, required) — [{ invoice_id, amount }]; amounts in the
//                                         deposit's currency. One element with a
//                                         fee = net-of-fee single match.
//   fee_gl_account_id     (string, optional) — where the gap (Σ allocations −
//                                              deposit) posts; required if gap > 0
//   fee_account_number    (string, optional) — alternative to fee_gl_account_id;
//                                              resolved to the GL account id
//   max_fee          (number, optional) — reject if the gap exceeds this
//   fx_gl_account_id (string, optional) — override the realized-FX (499) account
//
// Bearer-token OR session auth; allowlisted in src/proxy.ts. A wrong split is
// reversible with one POST /api/banking/uncategorize {transaction_id} (it
// reverses every payment created under the settlement JE).
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

  const rawAllocs = Array.isArray(body.allocations) ? body.allocations : null
  if (!rawAllocs || rawAllocs.length === 0) {
    return Response.json(
      { error: 'allocations required: [{ invoice_id, amount }, ...]' },
      { status: 400 }
    )
  }
  const allocations: SplitAllocation[] = []
  for (const r of rawAllocs) {
    const o = (r ?? {}) as Record<string, unknown>
    const invoiceId = String(o.invoice_id || o.invoiceId || '').trim()
    const paymentId = String(o.payment_id || o.paymentId || '').trim()
    const amount = Number(o.amount)
    if ((!invoiceId && !paymentId) || !Number.isFinite(amount) || amount <= 0) {
      return Response.json(
        { error: 'each allocation needs invoice_id OR payment_id and a positive amount' },
        { status: 400 }
      )
    }
    allocations.push(paymentId ? { paymentId, amount } : { invoiceId, amount })
  }

  // Resolve the fee account from an explicit id, or look it up by account number.
  let feeGlAccountId = String(body.fee_gl_account_id || '').trim() || undefined
  const feeAccountNumber = String(body.fee_account_number || '').trim()
  if (!feeGlAccountId && feeAccountNumber) {
    const acct = await prisma.gLAccount.findFirst({
      where: { accountNumber: feeAccountNumber },
      select: { id: true },
    })
    if (!acct) {
      return Response.json(
        { error: `fee_account_number ${feeAccountNumber} not found` },
        { status: 400 }
      )
    }
    feeGlAccountId = acct.id
  }

  const maxFeeRaw = Number(body.max_fee)
  const maxFee = Number.isFinite(maxFeeRaw) ? maxFeeRaw : undefined
  const fxGlAccountId = String(body.fx_gl_account_id || '').trim() || undefined

  const result = await matchTransactionSplit({
    txId: transactionId,
    allocations,
    feeGlAccountId,
    maxFee,
    fxGlAccountId,
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  return Response.json({
    ok: true,
    journal_entry_id: result.journalEntryId,
    payment_ids: result.paymentIds,
    deposit_cad: result.depositCad,
    fee_cad: result.feeCad,
    fx_net: result.fxNet,
  })
}
