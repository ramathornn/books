import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { glAccountSchema } from '@/lib/validators'

// GET is read-only and bearer-callable (headless agents resolve account ids
// here); POST (account creation) stays session-only.
export async function GET(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) return Response.json({ error: 'Unauthorized' }, { status: authed.status })

  const sp = request.nextUrl.searchParams
  const accountClass = sp.get('class')
  const where: Record<string, unknown> = { isArchived: false }
  if (accountClass) where.accountClass = accountClass

  const accounts = await prisma.gLAccount.findMany({
    where,
    include: { parent: true },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })
  return Response.json({ data: accounts })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = glAccountSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const d = parsed.data
  const account = await prisma.gLAccount.create({
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
      openingBalance: d.openingBalance,
      openingBalanceDate: d.openingBalanceDate ? new Date(d.openingBalanceDate) : null,
      currentBalance: d.openingBalance,
    },
  })
  return Response.json(account, { status: 201 })
}
