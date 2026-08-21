import prisma from '@/lib/prisma'

/**
 * Parse an "as of" date from a search param (YYYY-MM-DD). Falls back to today
 * when the param is missing or unparseable. The returned date is set to the end
 * of the day **in UTC** so the whole as-of day is inclusive — matching how
 * date-only entry dates are stored (UTC midnight) and how `lib/reportRange.ts`
 * builds its boundaries. A local-time boundary on a non-UTC box would sweep
 * next-day entries into the as-of balance.
 */
export function parseAsOfParam(
  value: string | string[] | undefined,
  now: Date = new Date()
): Date {
  const raw = Array.isArray(value) ? value[0] : value
  if (raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999))
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  // Local calendar date of `now` (the business day), end-of-day in UTC.
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999))
}

type GLAccountLike = {
  id: string
  accountClass: string
  openingBalance: unknown
  openingBalanceDate: Date | null
}

/**
 * Compute GL account balances as-of a given date from opening balance +
 * sum of posted JournalEntryLine with entryDate <= asOf.
 *
 * Sign follows account class: asset/expense are debit-normal; liability/
 * equity/income are credit-normal. Returns a Map of accountId -> balance.
 *
 * This is the single source of truth for "as of" balances, used by both the
 * Balance Sheet (current column) and the Trial Balance.
 */
export async function balancesAsOf(
  accounts: GLAccountLike[],
  asOf: Date
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (accounts.length === 0) return out

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: { in: accounts.map((a) => a.id) },
      journalEntry: { status: 'posted', entryDate: { lte: asOf } },
    },
    select: { glAccountId: true, debit: true, credit: true },
  })

  const byId = new Map(accounts.map((a) => [a.id, a]))

  for (const a of accounts) {
    let bal = Number(a.openingBalance)
    // Only include opening balance if its date is on/before as-of (or unset).
    if (a.openingBalanceDate && a.openingBalanceDate > asOf) bal = 0
    out.set(a.id, bal)
  }

  for (const l of lines) {
    const a = byId.get(l.glAccountId)
    if (!a) continue
    const debitNormal = a.accountClass === 'asset' || a.accountClass === 'expense'
    const delta = debitNormal
      ? Number(l.debit) - Number(l.credit)
      : Number(l.credit) - Number(l.debit)
    out.set(a.id, (out.get(a.id) || 0) + delta)
  }

  return out
}
