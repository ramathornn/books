import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { readAuth } from '@/lib/forecasts/api'
import { balancesAsOf, parseAsOfParam } from '@/lib/glBalances'

// Books' cash on hand as-of a date: GL balances of every non-archived bank
// account that holds cash (checking / savings / cash / wallet). Credit cards
// are liabilities and are excluded. Same source of truth as the Balance Sheet.
export async function GET(request: NextRequest) {
  const denied = await readAuth(request)
  if (denied) return denied
  const asOf = parseAsOfParam(request.nextUrl.searchParams.get('asOf') ?? undefined)
  const accounts = await prisma.bankAccount.findMany({
    where: { isArchived: false, accountType: { in: ['checking', 'savings', 'cash', 'wallet'] } },
    include: { glAccount: { select: { id: true, accountClass: true, openingBalance: true, openingBalanceDate: true, accountName: true, accountNumber: true } } },
    orderBy: { sortOrder: 'asc' },
  })
  const balances = await balancesAsOf(accounts.map((a) => a.glAccount), asOf)
  const items = accounts.map((a) => ({
    id: a.id,
    name: `${a.bankName}${a.accountNumberMasked ? ` ${a.accountNumberMasked}` : ''}`,
    glAccount: `${a.glAccount.accountNumber} ${a.glAccount.accountName}`,
    balance: Math.round((balances.get(a.glAccount.id) ?? 0) * 100) / 100,
  }))
  const total = Math.round(items.reduce((s, i) => s + i.balance, 0) * 100) / 100
  return Response.json({ data: { asOf: asOf.toISOString().slice(0, 10), total, accounts: items } })
}
