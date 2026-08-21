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

  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: {
      glAccount: true,
      _count: { select: { transactions: true } },
    },
  })
  if (!account) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(account)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const account = await prisma.bankAccount.update({
    where: { id },
    data: {
      bankName: body.bankName !== undefined ? String(body.bankName) : undefined,
      accountNumberMasked: body.accountNumberMasked !== undefined ? String(body.accountNumberMasked) : undefined,
      accountHolder: body.accountHolder !== undefined ? String(body.accountHolder) : undefined,
      accountType: body.accountType !== undefined ? String(body.accountType) : undefined,
      statementClosingDay:
        body.statementClosingDay === '' || body.statementClosingDay === null
          ? null
          : body.statementClosingDay !== undefined
          ? parseInt(String(body.statementClosingDay), 10)
          : undefined,
      isArchived: body.isArchived !== undefined ? !!body.isArchived : undefined,
      sortOrder: body.sortOrder !== undefined ? parseInt(String(body.sortOrder), 10) : undefined,
    },
    include: { glAccount: true },
  })

  // Cascade archive/restore to the linked GL account so a closed account also
  // leaves (or returns to) the Chart of Accounts. Guardrail: only HIDE the GL
  // account when its balance is ~0 — never hide a non-zero balance from the
  // trial balance. Restoring always brings both back.
  if (body.isArchived !== undefined) {
    const wantArchived = !!body.isArchived
    const balanceIsZero = Math.abs(Number(account.glAccount.currentBalance)) < 0.005
    if (!wantArchived || balanceIsZero) {
      await prisma.gLAccount.update({
        where: { id: account.glAccountId },
        data: { isArchived: wantArchived },
      })
    }
  }

  return Response.json(account)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const txCount = await prisma.bankTransaction.count({ where: { bankAccountId: id } })
  if (txCount > 0) {
    // Archive instead of delete to preserve transaction history
    await prisma.bankAccount.update({ where: { id }, data: { isArchived: true } })
    return Response.json({ archived: true })
  }
  await prisma.bankAccount.delete({ where: { id } })
  return Response.json({ deleted: true })
}
