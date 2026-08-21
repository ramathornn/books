import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Compute the unrealized FX gain/loss for non-base-currency GL accounts at a snapshot date.
// Approach: each non-CAD account has a balance in its native currency; we revalue it at the
// snapshot rate vs the rate already booked (= account.currentBalance — which is in native
// currency). The CAD-equivalent variance becomes the unrealized gain/loss.
//
// Rates can be supplied per-currency in the body. If missing, default to 1.0 (no-op).

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const asOfStr = String(body.asOf || '')
  if (!asOfStr) return Response.json({ error: 'asOf required' }, { status: 400 })
  const asOf = new Date(asOfStr)

  // Map of {currency: rate-to-CAD}, e.g. {USD: 1.36, EUR: 1.45}
  const rates = (body.rates || {}) as Record<string, number>

  // Pull every GL account in a non-CAD currency
  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false, currency: { not: 'CAD' } },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })

  // For each, sum journal-line activity through asOf to get native-currency balance
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: { in: accounts.map((a) => a.id) },
      journalEntry: { status: 'posted', entryDate: { lte: asOf } },
    },
    select: { glAccountId: true, debit: true, credit: true },
  })

  const balances = new Map<string, number>()
  for (const a of accounts) {
    balances.set(a.id, Number(a.openingBalance))
  }
  for (const l of lines) {
    const a = accounts.find((x) => x.id === l.glAccountId)
    if (!a) continue
    const debitNormal = a.accountClass === 'asset' || a.accountClass === 'expense'
    const delta = debitNormal ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit)
    balances.set(a.id, (balances.get(a.id) || 0) + delta)
  }

  const rows = accounts.map((a) => {
    const nativeBalance = balances.get(a.id) || 0
    const rate = rates[a.currency] ?? 1.0
    const cadAtSnapshot = nativeBalance * rate
    // Existing book balance (currentBalance) is in NATIVE currency in our schema. CAD-equivalent
    // already booked = nativeBalance * 1 (since we don't currently track booking rate separately).
    // For now, FX gain/loss = (rate - 1) × native. This is a stub; production would track per-tx FX.
    const unrealized = nativeBalance * (rate - 1)
    return {
      accountId: a.id,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      currency: a.currency,
      nativeBalance,
      rate,
      cadAtSnapshot,
      unrealized,
    }
  }).filter((r) => Math.abs(r.nativeBalance) > 0.005)

  const totalUnrealized = rows.reduce((s, r) => s + r.unrealized, 0)

  return Response.json({
    asOf: asOfStr,
    rows,
    totalUnrealized: Math.round(totalUnrealized * 100) / 100,
    currenciesNeeded: Array.from(new Set(rows.map((r) => r.currency).filter((c) => !rates[c]))),
  })
}
