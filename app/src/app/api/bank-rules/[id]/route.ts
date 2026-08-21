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

  const rule = await prisma.bankRule.findUnique({ where: { id } })
  if (!rule) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(rule)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const rule = await prisma.bankRule.update({
    where: { id },
    data: {
      name: body.name !== undefined ? String(body.name) : undefined,
      priority: body.priority !== undefined ? parseInt(String(body.priority), 10) : undefined,
      moneyDirection: body.moneyDirection,
      accountScope: body.accountScope,
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : undefined,
      conditionLogic: body.conditionLogic,
      conditions: body.conditions,
      pattern: body.pattern !== undefined ? String(body.pattern) : undefined,
      matchType:
        body.matchType !== undefined && ['exact', 'contains', 'regex'].includes(body.matchType)
          ? body.matchType
          : undefined,
      thenTransactionType: body.thenTransactionType,
      categoryGlAccountId: body.categoryGlAccountId === '' ? null : body.categoryGlAccountId,
      categoryId: body.categoryId === '' ? null : body.categoryId,
      vendorId: body.vendorId === '' ? null : body.vendorId,
      payee: body.payee,
      taxCodeId: body.taxCodeId === '' ? null : body.taxCodeId,
      memo: body.memo,
      memoAppend: body.memoAppend,
      splits: body.splits,
      autoAdd: body.autoAdd !== undefined ? !!body.autoAdd : undefined,
      isActive: body.isActive !== undefined ? !!body.isActive : undefined,
    },
  })
  return Response.json(rule)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  await prisma.bankRule.delete({ where: { id } })
  return Response.json({ deleted: true })
}
