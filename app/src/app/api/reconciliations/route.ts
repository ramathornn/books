import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const bankAccountId = sp.get('bankAccountId')
  const status = sp.get('status')

  const where: Record<string, unknown> = {}
  if (bankAccountId) where.bankAccountId = bankAccountId
  if (status) where.status = status

  const sessions = await prisma.reconciliationSession.findMany({
    where,
    orderBy: { statementEndDate: 'desc' },
    take: 50,
  })
  return Response.json({ data: sessions })
}

// POST — start a new reconciliation session
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const bankAccountId = String(body.bankAccountId || '')
  const statementStartDate = body.statementStartDate
    ? new Date(String(body.statementStartDate))
    : null
  const statementEndDate = body.statementEndDate ? new Date(String(body.statementEndDate)) : null
  const beginningBalance = parseFloat(String(body.beginningBalance || '0'))
  const endingBalance = parseFloat(String(body.endingBalance || '0'))

  if (!bankAccountId) return Response.json({ error: 'bankAccountId required' }, { status: 400 })
  if (!statementEndDate || isNaN(statementEndDate.getTime()))
    return Response.json({ error: 'statementEndDate required' }, { status: 400 })

  const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (!account) return Response.json({ error: 'Bank account not found' }, { status: 404 })

  // Default start = day after last reconciliation, or 1900-01-01 if first ever
  const startDate =
    statementStartDate ||
    (account.lastReconciledAt
      ? new Date(account.lastReconciledAt.getTime() + 24 * 60 * 60 * 1000)
      : new Date('2000-01-01'))

  // Don't allow overlapping in_progress sessions
  const existing = await prisma.reconciliationSession.findFirst({
    where: { bankAccountId, status: 'in_progress' },
  })
  if (existing) {
    return Response.json(
      { error: `Reconciliation already in progress (${existing.id}). Finish or abandon it first.` },
      { status: 400 }
    )
  }

  const created = await prisma.reconciliationSession.create({
    data: {
      bankAccountId,
      statementStartDate: startDate,
      statementEndDate,
      beginningBalance,
      endingBalance,
      status: 'in_progress',
    },
  })
  return Response.json(created, { status: 201 })
}
