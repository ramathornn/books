import prisma from '@/lib/prisma'

const SINGLETON_ID = 'singleton'

export interface PeriodLockState {
  lockedThrough: Date | null
  lockedAt: Date | null
  lockedById: string | null
  notes: string
}

export async function getPeriodLock(): Promise<PeriodLockState> {
  const row = await prisma.accountingPeriod.findUnique({ where: { id: SINGLETON_ID } })
  if (!row) {
    return { lockedThrough: null, lockedAt: null, lockedById: null, notes: '' }
  }
  return {
    lockedThrough: row.lockedThrough,
    lockedAt: row.lockedAt,
    lockedById: row.lockedById,
    notes: row.notes,
  }
}

export async function setPeriodLock(opts: {
  lockedThrough: Date | null
  userId?: string | null
  notes?: string
}): Promise<PeriodLockState> {
  const data = {
    lockedThrough: opts.lockedThrough,
    lockedAt: opts.lockedThrough ? new Date() : null,
    lockedById: opts.userId ?? null,
    notes: opts.notes ?? '',
  }
  const row = await prisma.accountingPeriod.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  })
  return {
    lockedThrough: row.lockedThrough,
    lockedAt: row.lockedAt,
    lockedById: row.lockedById,
    notes: row.notes,
  }
}

/**
 * Throw if the given date falls within (or before) the locked period.
 * Use in API endpoints that create/edit dated transactions.
 */
export async function assertNotLocked(date: Date): Promise<void> {
  const lock = await getPeriodLock()
  if (!lock.lockedThrough) return
  if (date.getTime() <= lock.lockedThrough.getTime()) {
    const dateStr = lock.lockedThrough.toISOString().slice(0, 10)
    const err = new Error(
      `Books are locked through ${dateStr}. Cannot create or edit transactions on or before that date.`
    )
    ;(err as Error & { code?: string }).code = 'PERIOD_LOCKED'
    throw err
  }
}
