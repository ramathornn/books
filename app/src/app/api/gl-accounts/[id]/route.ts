import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { glAccountSchema } from '@/lib/validators'

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const account = await prisma.gLAccount.findUnique({
    where: { id },
    include: { parent: true, children: true },
  })
  if (!account) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(account)
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  const body = await request.json()
  const parsed = glAccountSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const d = parsed.data
  const account = await prisma.gLAccount.update({
    where: { id },
    data: {
      accountNumber: d.accountNumber,
      accountName: d.accountName,
      description: d.description,
      accountClass: d.accountClass,
      accountSubclass: d.accountSubclass,
      detailType: d.detailType,
      gifiCode: d.gifiCode?.trim() || null,
      cashFlowSection: d.cashFlowSection ?? null,
      parentId: d.parentId || null,
      currency: d.currency,
      isReconcilable: d.isReconcilable,
    },
  })
  return Response.json(account)
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  const count = await prisma.journalEntryLine.count({ where: { glAccountId: id } })
  if (count > 0) {
    await prisma.gLAccount.update({ where: { id }, data: { isArchived: true } })
    return Response.json({ archived: true })
  }
  await prisma.gLAccount.delete({ where: { id } })
  return Response.json({ deleted: true })
}
