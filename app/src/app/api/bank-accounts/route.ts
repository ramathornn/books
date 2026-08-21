import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const includeArchived = sp.get('includeArchived') === '1'

  const accounts = await prisma.bankAccount.findMany({
    where: includeArchived ? {} : { isArchived: false },
    include: {
      glAccount: true,
      _count: { select: { transactions: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { bankName: 'asc' }],
  })
  return Response.json({ data: accounts })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    glAccountId,
    bankName,
    accountNumberMasked,
    accountHolder,
    accountType,
    statementClosingDay,
  } = body

  if (!glAccountId || !bankName) {
    return Response.json({ error: 'glAccountId and bankName are required' }, { status: 400 })
  }

  // Verify the GL account exists and isn't already linked
  const gl = await prisma.gLAccount.findUnique({ where: { id: glAccountId } })
  if (!gl) return Response.json({ error: 'GL account not found' }, { status: 400 })
  const existing = await prisma.bankAccount.findUnique({ where: { glAccountId } })
  if (existing) return Response.json({ error: 'GL account already linked to a bank account' }, { status: 400 })

  // Auto-pick a sortOrder
  const max = await prisma.bankAccount.aggregate({ _max: { sortOrder: true } })
  const sortOrder = (max._max.sortOrder || 0) + 1

  const account = await prisma.bankAccount.create({
    data: {
      glAccountId,
      bankName: String(bankName),
      accountNumberMasked: String(accountNumberMasked || ''),
      accountHolder: String(accountHolder || ''),
      accountType: String(accountType || 'checking'),
      statementClosingDay: statementClosingDay ? parseInt(String(statementClosingDay), 10) : null,
      sortOrder,
    },
    include: { glAccount: true },
  })
  return Response.json(account, { status: 201 })
}
