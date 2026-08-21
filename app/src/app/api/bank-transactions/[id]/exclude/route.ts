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

  const tx = await prisma.bankTransaction.findUnique({ where: { id } })
  if (!tx) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tx.status === 'posted') return Response.json({ error: 'Cannot exclude a posted transaction. Move back to Pending first.' }, { status: 400 })

  await prisma.bankTransaction.update({ where: { id }, data: { status: 'excluded' } })
  return Response.json({ ok: true })
}
