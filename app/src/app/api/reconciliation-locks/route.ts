import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

// Parse a YYYY-MM-DD string into a UTC date-only Date (no timezone drift).
function parseDateOnly(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim())
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return Number.isNaN(d.getTime()) ? null : d
}

// GET /api/reconciliation-locks?bankAccountId=... → list locks for an account.
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const bankAccountId = request.nextUrl.searchParams.get('bankAccountId') || undefined
  const locks = await prisma.reconciliationLock.findMany({
    where: bankAccountId ? { bankAccountId } : undefined,
    orderBy: { periodStart: 'desc' },
  })
  return Response.json({ locks })
}

// POST /api/reconciliation-locks → create a month-end lock for { bankAccountId,
// periodStart, periodEnd }. Idempotent-ish: unique on (bankAccountId, periodStart).
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const bankAccountId = String(body.bankAccountId || '')
  const periodStart = parseDateOnly(body.periodStart)
  const periodEnd = parseDateOnly(body.periodEnd)

  if (!bankAccountId) return Response.json({ error: 'bankAccountId required' }, { status: 400 })
  if (!periodStart || !periodEnd) {
    return Response.json({ error: 'periodStart and periodEnd must be YYYY-MM-DD' }, { status: 400 })
  }
  if (periodEnd.getTime() < periodStart.getTime()) {
    return Response.json({ error: 'periodEnd must be on or after periodStart' }, { status: 400 })
  }

  const account = await prisma.bankAccount.findUnique({
    where: { id: bankAccountId },
    include: { glAccount: true },
  })
  if (!account) return Response.json({ error: 'Bank account not found' }, { status: 404 })

  // Reject a lock that overlaps an existing one for this account.
  const overlap = await prisma.reconciliationLock.findFirst({
    where: {
      bankAccountId,
      periodStart: { lte: periodEnd },
      periodEnd: { gte: periodStart },
    },
  })
  if (overlap) {
    return Response.json(
      {
        error: `An overlapping reconciliation lock already exists (${overlap.periodStart
          .toISOString()
          .slice(0, 10)} → ${overlap.periodEnd.toISOString().slice(0, 10)}).`,
      },
      { status: 409 }
    )
  }

  const userId = (session.user as { id?: string }).id ?? null
  const lock = await prisma.reconciliationLock.create({
    data: { bankAccountId, periodStart, periodEnd, lockedBy: userId },
  })

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  await audit({
    entityType: 'reconciliation',
    entityId: lock.id,
    action: 'lock',
    summary: `Locked ${account.glAccount.accountNumber} ${account.glAccount.accountName} for ${fmt(
      periodStart
    )} → ${fmt(periodEnd)}`,
    metadata: { bankAccountId, periodStart: fmt(periodStart), periodEnd: fmt(periodEnd) },
  })

  return Response.json({ ok: true, lock })
}
