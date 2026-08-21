import prisma from '@/lib/prisma'

/**
 * Year-end close support.
 *
 * Net income for a fiscal year = Σ posted income/expense JournalEntryLine with
 * entryDate inside the year. The closing entry zeroes every income & expense
 * account into Retained Earnings:
 *   - income accounts are credit-normal → DR them by their balance
 *   - expense accounts are debit-normal → CR them by their balance
 *   - the plug (net income) goes to Retained Earnings: CR if net income > 0,
 *     DR if there is a net loss.
 *
 * We deliberately recompute income/expense balances from posted JE lines inside
 * the year window (not GLAccount.currentBalance, which is lifetime-to-date) so a
 * mid-life close is correct.
 */

export interface CloseAccountRow {
  accountId: string
  accountNumber: string
  accountName: string
  accountClass: 'income' | 'expense'
  /** Net balance for the year in the account's natural (credit/debit-normal) sign, always >= shown signed. */
  balance: number
  /** The closing-entry debit on this account (income closes via debit). */
  debit: number
  /** The closing-entry credit on this account (expense closes via credit). */
  credit: number
}

export interface RetainedEarningsAccount {
  id: string
  accountNumber: string
  accountName: string
}

export interface FiscalYearClosePreview {
  fiscalYear: number
  periodStart: string
  periodEnd: string
  totalIncome: number
  totalExpense: number
  netIncome: number
  rows: CloseAccountRow[]
  retainedEarnings: RetainedEarningsAccount | null
  /** The balanced closing-entry lines that COMMIT would post. */
  closingLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }>
  alreadyClosed: { closedAt: string; journalEntryId: string | null; netIncome: number } | null
  warnings: string[]
}

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Fiscal year boundaries. We treat the fiscal year as the calendar year ending
 * Dec 31 (matching the rest of the app's Dec-31 year-end assumptions, e.g. the
 * opening-balance migration). periodEnd is end-of-day so the whole Dec 31 is
 * inside the window.
 */
export function fiscalYearBounds(fiscalYear: number): { start: Date; end: Date } {
  const start = new Date(fiscalYear, 0, 1, 0, 0, 0, 0)
  const end = new Date(fiscalYear, 11, 31, 23, 59, 59, 999)
  return { start, end }
}

/**
 * Resolve the Retained Earnings equity account. Prefers an account named
 * "Retained Earnings"; falls back to any equity account whose name contains
 * "retained"; finally the lowest-numbered equity account.
 */
export async function findRetainedEarningsAccount() {
  const exact = await prisma.gLAccount.findFirst({
    where: {
      accountClass: 'equity',
      accountName: { equals: 'Retained Earnings', mode: 'insensitive' },
      isArchived: false,
    },
    orderBy: { accountNumber: 'asc' },
  })
  if (exact) return exact

  const fuzzy = await prisma.gLAccount.findFirst({
    where: {
      accountClass: 'equity',
      accountName: { contains: 'retained', mode: 'insensitive' },
      isArchived: false,
    },
    orderBy: { accountNumber: 'asc' },
  })
  return fuzzy
}

/**
 * Build the full preview for a fiscal-year close: per-account balances within
 * the year, net income, the resolved RE account, and the exact balanced closing
 * lines COMMIT would post. Pure read — posts nothing.
 */
export async function buildFiscalYearClosePreview(fiscalYear: number): Promise<FiscalYearClosePreview> {
  const { start, end } = fiscalYearBounds(fiscalYear)
  const warnings: string[] = []

  const existing = await prisma.fiscalYearClose.findUnique({ where: { fiscalYear } })

  // Income & expense accounts.
  const accounts = await prisma.gLAccount.findMany({
    where: { accountClass: { in: ['income', 'expense'] } },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    select: { id: true, accountNumber: true, accountName: true, accountClass: true },
  })

  // Sum posted JE-line activity inside the fiscal year.
  const lines = accounts.length
    ? await prisma.journalEntryLine.findMany({
        where: {
          glAccountId: { in: accounts.map((a) => a.id) },
          journalEntry: { status: 'posted', entryDate: { gte: start, lte: end } },
        },
        select: { glAccountId: true, debit: true, credit: true },
      })
    : []

  // Net per account in NATURAL sign (income credit-normal, expense debit-normal).
  const natural = new Map<string, number>()
  for (const a of accounts) natural.set(a.id, 0)
  for (const l of lines) {
    const a = accounts.find((x) => x.id === l.glAccountId)
    if (!a) continue
    const debitNormal = a.accountClass === 'expense'
    const delta = debitNormal
      ? Number(l.debit) - Number(l.credit)
      : Number(l.credit) - Number(l.debit)
    natural.set(a.id, (natural.get(a.id) || 0) + delta)
  }

  let totalIncome = 0
  let totalExpense = 0
  const rows: CloseAccountRow[] = []
  const closingLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = []

  for (const a of accounts) {
    const bal = r2(natural.get(a.id) || 0)
    if (Math.abs(bal) < 0.005) continue
    const isIncome = a.accountClass === 'income'

    // To zero the account, post the OPPOSITE of its natural balance:
    //   income (credit-normal, positive bal) → DR by bal
    //   expense (debit-normal, positive bal) → CR by bal
    // Negative balances flip the side; we keep both debit/credit fields and let
    // one be 0.
    let debit = 0
    let credit = 0
    if (isIncome) {
      totalIncome += bal
      if (bal >= 0) debit = bal
      else credit = -bal
    } else {
      totalExpense += bal
      if (bal >= 0) credit = bal
      else debit = -bal
    }

    rows.push({
      accountId: a.id,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      accountClass: a.accountClass as 'income' | 'expense',
      balance: bal,
      debit: r2(debit),
      credit: r2(credit),
    })
    closingLines.push({
      glAccountId: a.id,
      description: `Close ${a.accountClass} to Retained Earnings (FY${fiscalYear})`,
      debit: r2(debit),
      credit: r2(credit),
    })
  }

  totalIncome = r2(totalIncome)
  totalExpense = r2(totalExpense)
  const netIncome = r2(totalIncome - totalExpense)

  const re = await findRetainedEarningsAccount()
  if (!re) {
    warnings.push('No Retained Earnings equity account found in the chart of accounts. Create one before committing.')
  }

  // Retained Earnings plug. Net income (>0) increases equity → CR Retained
  // Earnings; a net loss → DR Retained Earnings. Use the difference of the
  // closing lines so the entry balances to the penny.
  if (re) {
    const td = r2(closingLines.reduce((s, l) => s + l.debit, 0))
    const tc = r2(closingLines.reduce((s, l) => s + l.credit, 0))
    const plug = r2(td - tc) // if income > expense, debits (closing income) exceed credits → CR RE
    if (Math.abs(plug) >= 0.005) {
      if (plug > 0) {
        closingLines.push({
          glAccountId: re.id,
          description: `Net income to Retained Earnings (FY${fiscalYear})`,
          debit: 0,
          credit: plug,
        })
      } else {
        closingLines.push({
          glAccountId: re.id,
          description: `Net loss to Retained Earnings (FY${fiscalYear})`,
          debit: -plug,
          credit: 0,
        })
      }
    }
  }

  return {
    fiscalYear,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    totalIncome,
    totalExpense,
    netIncome,
    rows,
    retainedEarnings: re
      ? { id: re.id, accountNumber: re.accountNumber, accountName: re.accountName }
      : null,
    closingLines,
    alreadyClosed: existing
      ? {
          closedAt: existing.closedAt.toISOString(),
          journalEntryId: existing.closingJournalEntryId,
          netIncome: Number(existing.netIncome),
        }
      : null,
    warnings,
  }
}
