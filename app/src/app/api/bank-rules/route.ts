import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const includeInactive = sp.get('includeInactive') === '1'

  const rules = await prisma.bankRule.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
  })
  return Response.json({ data: rules })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const name = String(body.name || '').trim()
  if (!name) return Response.json({ error: 'name required' }, { status: 400 })

  // Auto-priority: place at end if not specified
  let priority = body.priority
  if (priority === undefined || priority === null || priority === '') {
    const max = await prisma.bankRule.aggregate({ _max: { priority: true } })
    priority = (max._max.priority || 0) + 1
  }

  const rule = await prisma.bankRule.create({
    data: {
      name,
      priority: parseInt(String(priority), 10) || 0,
      moneyDirection: String(body.moneyDirection || 'both'),
      accountScope: String(body.accountScope || 'all'),
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
      conditionLogic: String(body.conditionLogic || 'any'),
      conditions: body.conditions ?? [],
      pattern: String(body.pattern || ''),
      matchType: ['exact', 'contains', 'regex'].includes(body.matchType) ? body.matchType : 'contains',
      thenTransactionType: String(body.thenTransactionType || 'expense'),
      categoryGlAccountId: body.categoryGlAccountId || null,
      categoryId: body.categoryId || null,
      vendorId: body.vendorId || null,
      payee: String(body.payee || ''),
      taxCodeId: body.taxCodeId || null,
      memo: String(body.memo || ''),
      memoAppend: String(body.memoAppend || ''),
      splits: body.splits ?? [],
      autoAdd: !!body.autoAdd,
      isActive: body.isActive !== false,
    },
  })
  return Response.json(rule, { status: 201 })
}
