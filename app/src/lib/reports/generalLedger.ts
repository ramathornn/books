import prisma from '@/lib/prisma'

export type GeneralLedgerRow = {
  date: Date
  entryNumber: string
  entryId: string
  description: string
  debit: number
  credit: number
  balance: number
}

export type GeneralLedgerAccount = {
  account: { id: string; accountNumber: string; accountName: string; accountClass: string }
  rows: GeneralLedgerRow[]
}

/**
 * General-ledger activity grouped by account for [start, end]: every posted
 * journal line in the range, in entry-date order, with a running balance signed
 * by account class (asset/expense debit-normal, the rest credit-normal). The
 * running balance starts at 0 at the range start — this is period activity,
 * not a cumulative account balance.
 */
export async function generalLedgerByAccount(
  start: Date,
  end: Date,
  currency: string
): Promise<GeneralLedgerAccount[]> {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: { entryDate: { gte: start, lte: end }, status: 'posted' },
      glAccount: { currency },
    },
    select: {
      debit: true,
      credit: true,
      description: true,
      glAccountId: true,
      glAccount: {
        select: { id: true, accountName: true, accountNumber: true, accountClass: true },
      },
      journalEntry: { select: { id: true, entryNumber: true, entryDate: true, description: true } },
    },
    orderBy: [{ glAccountId: 'asc' }, { journalEntry: { entryDate: 'asc' } }],
  })

  const byAccount = new Map<string, GeneralLedgerAccount>()
  for (const line of lines) {
    const k = line.glAccountId
    if (!byAccount.has(k)) byAccount.set(k, { account: line.glAccount, rows: [] })
    const entry = byAccount.get(k)!
    const cls = line.glAccount.accountClass
    const isDebitPositive = cls === 'asset' || cls === 'expense'
    const delta = isDebitPositive
      ? Number(line.debit) - Number(line.credit)
      : Number(line.credit) - Number(line.debit)
    const prev = entry.rows.length ? entry.rows[entry.rows.length - 1].balance : 0
    entry.rows.push({
      date: line.journalEntry.entryDate,
      entryNumber: line.journalEntry.entryNumber,
      entryId: line.journalEntry.id,
      description: line.description || line.journalEntry.description,
      debit: Number(line.debit),
      credit: Number(line.credit),
      balance: prev + delta,
    })
  }
  return Array.from(byAccount.values())
}
