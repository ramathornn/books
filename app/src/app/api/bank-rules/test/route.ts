import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { ruleMatches, type BankRuleLite, type BankTxLite } from '@/lib/bankRules'

// Test how many existing pending bank transactions the given draft rule would match.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const draft: BankRuleLite = {
    id: 'draft',
    name: String(body.name || 'Draft'),
    priority: 0,
    moneyDirection: String(body.moneyDirection || 'both'),
    accountScope: String(body.accountScope || 'all'),
    accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
    conditionLogic: String(body.conditionLogic || 'any'),
    conditions: body.conditions ?? [],
    pattern: String(body.pattern || ''),
    matchType: ['exact', 'contains', 'regex'].includes(body.matchType) ? body.matchType : 'contains',
    thenTransactionType: 'expense',
    categoryGlAccountId: null,
    categoryId: null,
    vendorId: null,
    payee: '',
    taxCodeId: null,
    memo: '',
    memoAppend: '',
    splits: [],
    autoAdd: false,
    isActive: true,
  }

  const txs = await prisma.bankTransaction.findMany({
    where: { status: 'pending' },
    take: 1000,
    orderBy: { transactionDate: 'desc' },
  })

  const matches = txs.filter((t) =>
    ruleMatches(draft, {
      bankAccountId: t.bankAccountId,
      amount: Number(t.amount),
      description: t.description,
      transactionDate: t.transactionDate,
    } as BankTxLite)
  )

  return Response.json({
    matchCount: matches.length,
    pendingCount: txs.length,
    sample: matches.slice(0, 5).map((t) => ({
      id: t.id,
      date: t.transactionDate.toISOString().slice(0, 10),
      description: t.description,
      amount: Number(t.amount),
    })),
  })
}
