import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { audit } from '@/lib/audit'

/**
 * Post an inverse journal entry that reverses an already-posted JE.
 *
 * Behaviour (per Wave 1 accrual spec §2 Phase 2):
 *  - Idempotent: if `jeId` already has a linked reversal, return that reversal
 *    without posting a second one.
 *  - The reversal is a fresh `kind:'reversal' status:'posted'` JE whose lines
 *    are the originals with debit/credit swapped, dated to the ORIGINAL
 *    entryDate. `createJournalEntry` runs `assertNotLocked` against that date —
 *    we deliberately do NOT clamp, so a locked period throws PERIOD_LOCKED and
 *    the reversal is refused.
 *  - The original keeps `status:'posted'` (there is no 'reversed' status); we
 *    only stamp `reversedAt` / `reversedReason` and link the two via
 *    `reversal.reversesId`.
 *  - Emits `audit({action:'reverse'})` for both the reversal and the original.
 */
export async function reverseJournalEntry(jeId: string, reason: string) {
  const original = await prisma.journalEntry.findUnique({
    where: { id: jeId },
    include: { lines: true, reversal: true },
  })
  if (!original) throw new Error('Journal entry not found')

  // Idempotent — already reversed.
  if (original.reversal) return original.reversal
  if (original.reversesId) {
    // This entry is itself a reversal; refuse to reverse a reversal.
    throw new Error(`Journal entry ${original.entryNumber} is a reversal and cannot itself be reversed`)
  }
  if (original.status !== 'posted') {
    throw new Error(`Journal entry ${original.entryNumber} is '${original.status}', only posted entries can be reversed`)
  }

  // Swap debit/credit per line for the inverse entry.
  const lines = original.lines
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({
      glAccountId: l.glAccountId,
      description: l.description,
      debit: Number(l.credit),
      credit: Number(l.debit),
      taxCodeId: l.taxCodeId ?? null,
    }))

  const reversal = await prisma.$transaction(async (tx) => {
    const rev = await createJournalEntry({
      entryDate: original.entryDate,
      description: `Reversal of ${original.entryNumber}${reason ? ` — ${reason}` : ''}`,
      memo: reason,
      status: 'posted',
      kind: 'reversal',
      reversesId: original.id,
      lines,
      client: tx,
    })
    await tx.journalEntry.update({
      where: { id: original.id },
      data: { reversedAt: new Date(), reversedReason: reason },
    })
    return rev
  })

  await audit({
    entityType: 'journal_entry',
    entityId: reversal.id,
    action: 'reverse',
    summary: `${reversal.entryNumber} reverses ${original.entryNumber}${reason ? ` · ${reason}` : ''}`,
    metadata: { reversesId: original.id, reversesNumber: original.entryNumber },
  })
  await audit({
    entityType: 'journal_entry',
    entityId: original.id,
    action: 'reverse',
    summary: `${original.entryNumber} reversed by ${reversal.entryNumber}${reason ? ` · ${reason}` : ''}`,
    metadata: { reversalId: reversal.id, reversalNumber: reversal.entryNumber },
  })

  return reversal
}
