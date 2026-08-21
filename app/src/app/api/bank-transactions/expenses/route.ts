import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Bank transactions that became expenses: posted, categorized to a GL account
// whose class is 'expense'. Surfaced in the Expenses section so card/bank spend
// shows alongside manually-entered expenses. Filterable by bank account and by
// reconciled status.
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const bankAccountId = sp.get('bankAccountId') || ''
  const reconciled = sp.get('reconciled') || '' // 'true' | 'false' | '' (all)

  const expenseGl = await prisma.gLAccount.findMany({
    where: { accountClass: 'expense' },
    select: { id: true, accountName: true },
  })
  const nameById = new Map(expenseGl.map((g) => [g.id, g.accountName]))

  const where: Record<string, unknown> = {
    status: 'posted',
    categoryGlAccountId: { in: expenseGl.map((g) => g.id) },
  }
  if (bankAccountId) where.bankAccountId = bankAccountId
  if (reconciled === 'true') where.isReconciled = true
  else if (reconciled === 'false') where.isReconciled = false

  const txns = await prisma.bankTransaction.findMany({
    where,
    orderBy: { transactionDate: 'desc' },
    take: 300,
    include: { bankAccount: { include: { glAccount: true } } },
  })

  return Response.json({
    rows: txns.map((t) => ({
      id: t.id,
      bankAccountId: t.bankAccountId,
      bankAccountName: t.bankAccount.glAccount.accountName,
      currency: t.bankAccount.glAccount.currency,
      date: t.transactionDate.toISOString().slice(0, 10),
      description: t.description,
      payee: t.payee,
      category: t.categoryGlAccountId ? nameById.get(t.categoryGlAccountId) || '' : '',
      amount: Math.abs(Number(t.amount)),
      isReconciled: t.isReconciled,
    })),
  })
}
