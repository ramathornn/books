import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { categorizeBankTransaction } from '@/lib/categorizeBankTransaction'

// POST /api/banking/categorize — headless single-transaction categorize.
//
// Body (JSON):
//   transaction_id (string, required) — the pending bank transaction to post
//   gl_account_id  (string, required) — the expense/income GL category
//   tax_code_id    (string, optional) — explicit tax code; pass "" for "no tax"
//                                       (omit the key entirely to use the GL
//                                       account's default tax code)
//   memo           (string, optional)
//
// Posts the balanced journal entry via the shared helper
// (src/lib/categorizeBankTransaction.ts), which derives GST, respects the
// period lock and month-end reconciliation lock, and guards re-posting.
//
// Idempotent: if the transaction is already posted, returns its existing
// journal_entry_id (with a note) instead of double-posting.
export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Expected JSON body with transaction_id and gl_account_id' },
      { status: 400 }
    )
  }

  const transactionId = String(body.transaction_id || '').trim()
  if (!transactionId) {
    return Response.json({ error: 'transaction_id required' }, { status: 400 })
  }

  const glAccountId = String(body.gl_account_id || '').trim()
  if (!glAccountId) {
    return Response.json({ error: 'gl_account_id required' }, { status: 400 })
  }

  // Idempotency: if this transaction is already posted, return its existing
  // journal entry rather than letting the helper reject it (and never double-post).
  const existing = await prisma.bankTransaction.findUnique({
    where: { id: transactionId },
    select: { id: true, status: true, journalEntryId: true },
  })
  if (!existing) {
    return Response.json({ error: 'Bank transaction not found' }, { status: 404 })
  }
  if (existing.status === 'posted') {
    return Response.json({
      ok: true,
      journal_entry_id: existing.journalEntryId,
      note: 'Transaction already posted; returning existing journal entry.',
    })
  }

  // Tri-state tax handling: presence of the `tax_code_id` key means the caller
  // chose explicitly (incl. "" for no tax); absence falls back to the GL
  // account's default tax code.
  const hasTaxCodeKey = Object.prototype.hasOwnProperty.call(body, 'tax_code_id')
  const taxCodeId = hasTaxCodeKey ? String(body.tax_code_id ?? '') : undefined
  const memo = body.memo != null ? String(body.memo) : undefined

  const result = await categorizeBankTransaction(transactionId, {
    categoryGlAccountId: glAccountId,
    taxCodeId,
    hasTaxCodeKey,
    memo,
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status })
  }

  return Response.json({ ok: true, journal_entry_id: result.journalEntryId })
}
