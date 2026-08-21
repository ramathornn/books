import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Finalize a receipt-draft expense into a real one (clears isReceiptDraft).
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const e = await prisma.expense.findUnique({ where: { id } })
  if (!e) return Response.json({ error: 'Not found' }, { status: 404 })
  if (Number(e.amount) <= 0) {
    return Response.json({ error: 'Set an amount before adding to books.' }, { status: 400 })
  }
  await prisma.expense.update({ where: { id }, data: { isReceiptDraft: false } })
  return Response.json({ ok: true })
}
