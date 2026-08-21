import prisma from '@/lib/prisma'

/**
 * The "effective" set of slips for a type/year: the latest non-cancelled row
 * per `slipNumber`. Append-only amendments mean a single logical slip can have
 * several rows (amendmentSeq 0,1,2…); the tail (highest amendmentSeq) is the
 * current truth, unless it's a cancellation.
 *
 * This is the SINGLE source of truth for Summary aggregation and filing, so the
 * Summary page and the filing export can never diverge (design finding #5).
 * The stored `TaxSlipSummary` is only an as-filed snapshot.
 */

export interface EffectiveSlipRow {
  id: string
  type: string
  taxYear: number
  status: string
  slipNumber: string | null
  amendmentSeq: number
  isCancelled: boolean
  boxes: unknown
  boxesOverride: unknown
  partyId: string
  recipientNameSnapshot: string
}

/**
 * Pure reducer over slip rows. Groups by `slipNumber` (rows without a
 * slipNumber — i.e. drafts — are keyed by their own id so each stands alone),
 * keeps the highest `amendmentSeq` per group, then drops any group whose tail
 * is cancelled. Deterministic and unit-testable independent of the DB.
 */
export function effectiveSlips<T extends EffectiveSlipRow>(rows: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const key = row.slipNumber ?? `__draft__:${row.id}`
    const existing = byKey.get(key)
    if (!existing || row.amendmentSeq > existing.amendmentSeq) {
      byKey.set(key, row)
    }
  }
  return [...byKey.values()].filter((r) => !r.isCancelled && r.status !== 'cancelled')
}

/** DB adapter: load all slips for a type/year and reduce to the effective tail. */
export async function effectiveSlipsForYear(
  type: string,
  taxYear: number
): Promise<EffectiveSlipRow[]> {
  const rows = await prisma.taxSlip.findMany({
    where: { type, taxYear },
    select: {
      id: true,
      type: true,
      taxYear: true,
      status: true,
      slipNumber: true,
      amendmentSeq: true,
      isCancelled: true,
      boxes: true,
      boxesOverride: true,
      partyId: true,
      recipientNameSnapshot: true,
    },
    orderBy: [{ slipNumber: 'asc' }, { amendmentSeq: 'asc' }],
  })
  return effectiveSlips(rows as EffectiveSlipRow[])
}
