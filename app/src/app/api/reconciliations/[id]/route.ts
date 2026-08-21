import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const sess = await prisma.reconciliationSession.findUnique({ where: { id } })
  if (!sess) return Response.json({ error: 'Not found' }, { status: 404 })

  const account = await prisma.bankAccount.findUnique({
    where: { id: sess.bankAccountId },
    include: { glAccount: true },
  })

  // All Posted bank transactions in the date window for this account
  const txs = await prisma.bankTransaction.findMany({
    where: {
      bankAccountId: sess.bankAccountId,
      status: 'posted',
      transactionDate: {
        gte: sess.statementStartDate,
        lte: sess.statementEndDate,
      },
    },
    orderBy: { transactionDate: 'asc' },
  })

  return Response.json({
    session: sess,
    account: account
      ? {
          id: account.id,
          accountNumber: account.glAccount.accountNumber,
          accountName: account.glAccount.accountName,
          currency: account.glAccount.currency,
          bookBalance: Number(account.glAccount.currentBalance),
        }
      : null,
    transactions: txs,
  })
}

// PUT — toggle cleared on a list of tx ids
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const sess = await prisma.reconciliationSession.findUnique({ where: { id } })
  if (!sess) return Response.json({ error: 'Not found' }, { status: 404 })
  if (sess.status === 'completed')
    return Response.json({ error: 'Already completed' }, { status: 400 })

  const body = await request.json()
  const cleared = Array.isArray(body.cleared) ? (body.cleared as string[]) : []
  const uncleared = Array.isArray(body.uncleared) ? (body.uncleared as string[]) : []

  if (cleared.length) {
    await prisma.bankTransaction.updateMany({
      where: { id: { in: cleared }, bankAccountId: sess.bankAccountId },
      data: { reconciliationSessionId: id, isReconciled: false },
    })
  }
  if (uncleared.length) {
    await prisma.bankTransaction.updateMany({
      where: { id: { in: uncleared }, bankAccountId: sess.bankAccountId },
      data: { reconciliationSessionId: null, isReconciled: false },
    })
  }

  // Recompute cleared totals
  const clearedTxs = await prisma.bankTransaction.findMany({
    where: { reconciliationSessionId: id },
  })
  const debits = clearedTxs.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0)
  const credits = clearedTxs.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0)

  await prisma.reconciliationSession.update({
    where: { id },
    data: { clearedDebits: debits, clearedCredits: credits },
  })

  return Response.json({ ok: true, clearedCount: clearedTxs.length, clearedDebits: debits, clearedCredits: credits })
}

// DELETE — abandon
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  // Unlink any tx pointing at this session, then mark abandoned
  await prisma.bankTransaction.updateMany({
    where: { reconciliationSessionId: id },
    data: { reconciliationSessionId: null },
  })
  await prisma.reconciliationSession.update({
    where: { id },
    data: { status: 'abandoned' },
  })
  return Response.json({ ok: true })
}
