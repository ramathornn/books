import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { balancesAsOf } from '@/lib/glBalances'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/accounts/:id/ledger?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Read-only, bearer-authed (same auth as the other headless endpoints). Returns
// the posted journal-entry activity for one GL account over a date window, with
// a running natural-signed balance, plus the opening balance (everything before
// `start`) and the closing balance. `:id` is the GL account id OR its account
// number (e.g. "4000"), so callers can hit it by the number they see on screen.
//
//   { account, period:{start,end}, opening_balance,
//     rows:[{date, entryNumber, description, debit, credit, balance}],
//     totals:{debit, credit}, closing_balance }
//
// Use it to read, e.g., the exact 2025-vs-2026 revenue split (sum credits in
// each window) or the running shareholder-loan balance.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const { id } = await params

  // Resolve by id first, then fall back to account number.
  const account =
    (await prisma.gLAccount.findUnique({
      where: { id },
      select: {
        id: true, accountNumber: true, accountName: true, accountClass: true,
        currency: true, openingBalance: true, openingBalanceDate: true,
      },
    })) ||
    (await prisma.gLAccount.findFirst({
      where: { accountNumber: id },
      select: {
        id: true, accountNumber: true, accountName: true, accountClass: true,
        currency: true, openingBalance: true, openingBalanceDate: true,
      },
    }))

  if (!account) {
    return Response.json({ error: 'Account not found' }, { status: 404 })
  }

  // Window: start defaults to the beginning of time, end to now (end-of-day).
  const sp = request.nextUrl.searchParams
  const parseDay = (v: string | null, endOfDay: boolean): Date | null => {
    if (!v) return null
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
    if (!m) return null
    return endOfDay
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
      : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  }
  const start = parseDay(sp.get('start'), false) ?? new Date(0)
  const end = parseDay(sp.get('end'), true) ?? new Date()

  const debitNormal =
    account.accountClass === 'asset' || account.accountClass === 'expense'
  const round2 = (n: number) => Math.round(n * 100) / 100

  // Opening balance = balance through the instant just before `start`.
  const beforeStart = new Date(start.getTime() - 1)
  const openingMap = await balancesAsOf([account], beforeStart)
  const opening = openingMap.get(account.id) ?? 0

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: account.id,
      journalEntry: { status: 'posted', entryDate: { gte: start, lte: end } },
    },
    select: {
      debit: true,
      credit: true,
      description: true,
      journalEntry: {
        select: { entryNumber: true, entryDate: true, description: true },
      },
    },
    orderBy: [{ journalEntry: { entryDate: 'asc' } }, { sortOrder: 'asc' }],
  })

  let running = opening
  let totalDebit = 0
  let totalCredit = 0
  const rows = lines.map((l) => {
    const debit = Number(l.debit || 0)
    const credit = Number(l.credit || 0)
    totalDebit += debit
    totalCredit += credit
    running += debitNormal ? debit - credit : credit - debit
    return {
      date: l.journalEntry.entryDate.toISOString().slice(0, 10),
      entryNumber: l.journalEntry.entryNumber,
      description: l.description || l.journalEntry.description,
      debit: round2(debit),
      credit: round2(credit),
      balance: round2(running),
    }
  })

  return Response.json(
    {
      account: {
        id: account.id,
        number: account.accountNumber,
        name: account.accountName,
        class: account.accountClass,
        currency: account.currency,
        normal_side: debitNormal ? 'debit' : 'credit',
      },
      period: {
        start: sp.get('start') || null,
        end: end.toISOString().slice(0, 10),
      },
      opening_balance: round2(opening),
      rows,
      totals: { debit: round2(totalDebit), credit: round2(totalCredit) },
      closing_balance: round2(running),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } }
  )
}
