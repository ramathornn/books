import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const sess = await prisma.reconciliationSession.findUnique({ where: { id } })
  if (!sess) return Response.json({ error: 'Not found' }, { status: 404 })
  if (sess.status === 'completed')
    return Response.json({ error: 'Already completed' }, { status: 400 })

  // Verify difference is zero-ish: cleared net + beginning = ending
  const clearedTxs = await prisma.bankTransaction.findMany({
    where: { reconciliationSessionId: id },
  })
  const clearedNet = clearedTxs.reduce((s, t) => s + Number(t.amount), 0)
  const computedEnding = Number(sess.beginningBalance) + clearedNet
  const diff = Math.round((Number(sess.endingBalance) - computedEnding) * 100) / 100
  if (Math.abs(diff) > 0.005) {
    return Response.json(
      {
        error: `Cannot finish — difference is ${diff}. Tick or untick lines until the difference is 0.00.`,
      },
      { status: 400 }
    )
  }

  // Mark all cleared tx as reconciled
  await prisma.bankTransaction.updateMany({
    where: { reconciliationSessionId: id },
    data: { isReconciled: true, reconciledAt: new Date() },
  })

  await prisma.reconciliationSession.update({
    where: { id },
    data: {
      status: 'completed',
      completedAt: new Date(),
      completedById: (session.user as { id?: string }).id ?? null,
    },
  })

  // Update bank account aggregate
  await prisma.bankAccount.update({
    where: { id: sess.bankAccountId },
    data: {
      lastReconciledAt: sess.statementEndDate,
      reconciledBalance: sess.endingBalance,
    },
  })

  return Response.json({ ok: true })
}
