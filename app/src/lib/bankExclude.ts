import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

export type ExcludeResult =
  | { ok: true; status?: number; alreadyExcluded?: boolean }
  | { ok: false; status: number; error: string }

/**
 * Exclude a pending bank transaction from the books: it is neither income nor an
 * expense (e.g. an internal balance line, a duplicate, or noise). Sets
 * status='excluded' and records the optional reason in the transaction memo.
 *
 * Idempotent: an already-excluded transaction returns { ok: true,
 * alreadyExcluded: true } without re-writing. A posted transaction is rejected
 * (must be moved back to Pending first), mirroring the existing exclude route.
 */
export async function excludeTransaction(txId: string, reason?: string): Promise<ExcludeResult> {
  const tx = await prisma.bankTransaction.findUnique({ where: { id: txId } })
  if (!tx) return { ok: false, status: 404, error: 'Bank transaction not found' }

  // Idempotent: already excluded → no-op success.
  if (tx.status === 'excluded') return { ok: true, alreadyExcluded: true }

  if (tx.status === 'posted') {
    return { ok: false, status: 400, error: 'Cannot exclude a posted transaction. Move back to Pending first.' }
  }

  const trimmedReason = (reason || '').trim()
  // Stash the reason in the memo without clobbering an existing memo.
  const memo = trimmedReason
    ? tx.memo
      ? `${tx.memo} · Excluded: ${trimmedReason}`
      : `Excluded: ${trimmedReason}`
    : tx.memo

  await prisma.bankTransaction.update({
    where: { id: txId },
    data: { status: 'excluded', memo },
  })

  await audit({
    entityType: 'bank_transaction',
    entityId: txId,
    action: 'update',
    summary: `Excluded ${tx.description.slice(0, 60)}${trimmedReason ? ` — ${trimmedReason}` : ''}`,
    metadata: { reason: trimmedReason || null, amount: Number(tx.amount) },
  })

  return { ok: true }
}
