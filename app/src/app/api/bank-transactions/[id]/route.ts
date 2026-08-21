import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { assertNotReconLocked } from '@/lib/reconLock'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const tx = await prisma.bankTransaction.findUnique({
    where: { id },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!tx) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(tx)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const tx = await prisma.bankTransaction.findUnique({ where: { id } })
  if (!tx) return Response.json({ error: 'Not found' }, { status: 404 })
  // Month-end reconciliation lock: can't delete a tx in a locked month.
  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 423 })
  }
  await prisma.bankTransaction.delete({ where: { id } })
  return Response.json({ deleted: true })
}
