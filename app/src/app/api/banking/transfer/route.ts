import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { pairTransfer, PairTransferError } from '@/lib/bankTransfer'

// POST /api/banking/transfer — headless pairing of two of your own bank lines
// (one outflow + one inflow) into a single transfer journal entry.
//
// Body (JSON):
//   source_transaction_id (string, required) — the line you acted on
//   dest_transaction_id   (string, required) — the matching line in the OTHER account
//   exchange_rate         (number, optional) — explicit CAD-per-unit rate for the
//                          FOREIGN leg of a cross-currency transfer
//
// Delegates to pairTransfer() in src/lib/bankTransfer.ts, which posts CAD-
// converted amounts (so cross-currency transfers balance) and books any realized
// FX spread to 499. Idempotent: if the source line is already posted as a
// transfer, returns the existing journal_entry_id / transfer_pair_id instead of
// erroring.
export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Expected a JSON body with source_transaction_id and dest_transaction_id' },
      { status: 400 }
    )
  }

  const b = (body ?? {}) as Record<string, unknown>
  const sourceTransactionId = String(b.source_transaction_id || '').trim()
  const destTransactionId = String(b.dest_transaction_id || '').trim()

  if (!sourceTransactionId) {
    return Response.json({ error: 'source_transaction_id required' }, { status: 400 })
  }
  if (!destTransactionId) {
    return Response.json({ error: 'dest_transaction_id required' }, { status: 400 })
  }

  let explicitRate: number | undefined
  if (b.exchange_rate !== undefined && b.exchange_rate !== null && b.exchange_rate !== '') {
    const rate = Number(b.exchange_rate)
    if (!Number.isFinite(rate) || rate <= 0) {
      return Response.json(
        { error: 'exchange_rate must be a positive number' },
        { status: 400 }
      )
    }
    explicitRate = rate
  }

  // Idempotency: if the source line is already posted as part of a transfer
  // pair, surface the existing JE/pair rather than failing the re-post guard.
  const existing = await prisma.bankTransaction.findUnique({
    where: { id: sourceTransactionId },
    select: { status: true, journalEntryId: true, transferPairId: true },
  })
  if (existing?.status === 'posted' && existing.transferPairId) {
    return Response.json({
      ok: true,
      journal_entry_id: existing.journalEntryId,
      transfer_pair_id: existing.transferPairId,
      fx_difference: 0,
    })
  }

  try {
    const result = await pairTransfer({
      txId: sourceTransactionId,
      counterpartTxId: destTransactionId,
      explicitRate,
    })
    return Response.json({
      ok: true,
      journal_entry_id: result.journalEntryId,
      transfer_pair_id: result.transferPairId,
      fx_difference: result.fxDifference,
    })
  } catch (err) {
    if (err instanceof PairTransferError) {
      return Response.json({ error: err.message }, { status: err.status })
    }
    const message = err instanceof Error ? err.message : 'Failed to pair transfer'
    return Response.json({ error: message }, { status: 500 })
  }
}
