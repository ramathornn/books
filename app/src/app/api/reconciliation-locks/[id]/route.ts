import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

// DELETE /api/reconciliation-locks/[id] → release a month-end lock.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const lock = await prisma.reconciliationLock.findUnique({ where: { id } })
  if (!lock) return Response.json({ error: 'Lock not found' }, { status: 404 })

  const account = await prisma.bankAccount.findUnique({
    where: { id: lock.bankAccountId },
    include: { glAccount: true },
  })

  await prisma.reconciliationLock.delete({ where: { id } })

  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  await audit({
    entityType: 'reconciliation',
    entityId: lock.id,
    action: 'unlock',
    summary: account
      ? `Released lock on ${account.glAccount.accountNumber} ${account.glAccount.accountName} for ${fmt(
          lock.periodStart
        )} → ${fmt(lock.periodEnd)}`
      : `Released reconciliation lock ${fmt(lock.periodStart)} → ${fmt(lock.periodEnd)}`,
    metadata: {
      bankAccountId: lock.bankAccountId,
      periodStart: fmt(lock.periodStart),
      periodEnd: fmt(lock.periodEnd),
    },
  })

  return Response.json({ ok: true })
}
