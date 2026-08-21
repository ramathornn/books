import prisma from '@/lib/prisma'

/**
 * Month-end reconciliation lock.
 *
 * A ReconciliationLock freezes a single bank account's transactions for a date
 * range (typically a calendar month). Once locked, the transactions whose date
 * falls inside that range can no longer be categorized, matched, transferred,
 * unposted, or edited — mirroring the global period-lock, but scoped to ONE
 * account + month so other accounts/months stay editable.
 *
 * Dates are stored as `@db.Date` (date-only). We normalize to UTC midnight so a
 * transaction dated on `periodEnd` (the last day of the month) is still treated
 * as inside the lock.
 */

/** Normalize a Date to UTC midnight (date-only comparison). */
function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export interface ReconLockRow {
  id: string
  bankAccountId: string
  periodStart: Date
  periodEnd: Date
  lockedAt: Date
  lockedBy: string | null
}

/**
 * Throw if `date` falls within a ReconciliationLock for `bankAccountId`.
 * Call this in any route that creates/edits/reverses a dated bank transaction,
 * alongside the existing global period-lock check (which lives in
 * createJournalEntry / assertNotLocked).
 */
export async function assertNotReconLocked(
  bankAccountId: string,
  date: Date
): Promise<void> {
  const day = dateOnly(date)
  const lock = await prisma.reconciliationLock.findFirst({
    where: {
      bankAccountId,
      periodStart: { lte: day },
      periodEnd: { gte: day },
    },
  })
  if (!lock) return

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const err = new Error(
    `This account is reconciliation-locked for ${fmt(lock.periodStart)} → ${fmt(lock.periodEnd)}. ` +
      `Release the lock for that month before editing transactions in it.`
  )
  ;(err as Error & { code?: string }).code = 'RECON_LOCKED'
  throw err
}

/** List active locks for an account (newest first). */
export async function listReconLocks(bankAccountId: string): Promise<ReconLockRow[]> {
  return prisma.reconciliationLock.findMany({
    where: { bankAccountId },
    orderBy: { periodStart: 'desc' },
  })
}
