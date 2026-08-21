import prisma from '@/lib/prisma'
import {
  DEFAULT_FISCAL_YEAR_END,
  fiscalQuarterBounds,
  fiscalQuarterOf,
  type FiscalYearEnd,
} from '@/lib/fiscalYear'

export type PLData = {
  totalIncome: number
  /** Income grouped by GL account (accrual/GL basis). Empty for cash basis. */
  incomeByAcct: Map<string, { name: string; total: number }>
  expenseByCat: Map<string, { name: string; total: number }>
  totalExpenses: number
  netProfit: number
}

/**
 * Accrual P&L from the GENERAL LEDGER.
 *
 * Sums posted JournalEntryLine rows whose journal entry has status 'posted' and
 * entryDate within [start, end], grouped by GLAccount:
 *   - Income (credit-normal):  credit − debit
 *   - Expense (debit-normal):  debit − credit
 *   - Net income = revenue − expenses
 *
 * This captures both invoice accruals (DR A/R / CR Sales) and bank-categorized
 * income/expense, since both now post to the GL. The GL is CAD, so this is CAD.
 */
export async function computePLFromGL(start: Date, end: Date): Promise<PLData> {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccount: { accountClass: { in: ['income', 'expense'] } },
      journalEntry: { status: 'posted', entryDate: { gte: start, lte: end } },
    },
    select: {
      debit: true,
      credit: true,
      glAccount: {
        select: { id: true, accountName: true, accountNumber: true, accountClass: true },
      },
    },
    // Chart-of-accounts order. The maps below are keyed by account and filled in
    // iteration order, so ordering here is what puts the report's account rows in
    // account-number order without the maps having to carry the number.
    orderBy: { glAccount: { accountNumber: 'asc' } },
  })

  let totalIncome = 0
  let totalExpenses = 0
  const incomeByAcct = new Map<string, { name: string; total: number }>()
  const expenseByCat = new Map<string, { name: string; total: number }>()

  for (const l of lines) {
    const a = l.glAccount
    const debit = Number(l.debit)
    const credit = Number(l.credit)
    if (a.accountClass === 'income') {
      const amount = credit - debit
      if (!incomeByAcct.has(a.id)) incomeByAcct.set(a.id, { name: a.accountName, total: 0 })
      incomeByAcct.get(a.id)!.total += amount
      totalIncome += amount
    } else {
      const amount = debit - credit
      if (!expenseByCat.has(a.id)) expenseByCat.set(a.id, { name: a.accountName, total: 0 })
      expenseByCat.get(a.id)!.total += amount
      totalExpenses += amount
    }
  }

  return { totalIncome, incomeByAcct, expenseByCat, totalExpenses, netProfit: totalIncome - totalExpenses }
}

/**
 * Cash-basis P&L (legacy): income recognized when payment received, expenses when
 * cash leaves. This does NOT read the GL; it is kept so the Cash toggle keeps working.
 */
export async function computePLCash(start: Date, end: Date, currency: string): Promise<PLData> {
  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: start, lte: end }, currency },
    select: { amount: true },
  })
  const totalIncome = payments.reduce((s, p) => s + Number(p.amount), 0)

  const expenseByCat = new Map<string, { name: string; total: number }>()
  let totalExpenses = 0

  // Cash basis expense = expense paid date (Expense rows track when the receipt was logged,
  // which usually equals paid date) plus cash actually leaving for A/P bills (Bill payments).
  const expenses = await prisma.expense.findMany({
    where: { date: { gte: start, lte: end }, isArchived: false, currency },
    include: { category: true },
  })
  for (const e of expenses) {
    const k = e.categoryId
    if (!expenseByCat.has(k)) expenseByCat.set(k, { name: e.category.name, total: 0 })
    expenseByCat.get(k)!.total += Number(e.amount)
    totalExpenses += Number(e.amount)
  }
  // Add Bill payments — allocate proportionally across the bill's lines
  const billPayments = await prisma.billPayment.findMany({
    where: { paymentDate: { gte: start, lte: end } },
    include: { bill: { include: { lines: true, vendor: true } } },
  })
  for (const bp of billPayments) {
    const totalNet = bp.bill.lines.reduce((s, l) => s + Number(l.amount), 0)
    if (totalNet === 0) continue
    const ratio = Number(bp.amount) / Number(bp.bill.total)
    for (const line of bp.bill.lines) {
      if (!line.categoryGlAccountId) continue
      const portion = Number(line.amount) * ratio
      const k = `gl:${line.categoryGlAccountId}`
      if (!expenseByCat.has(k)) {
        const gl = await prisma.gLAccount.findUnique({ where: { id: line.categoryGlAccountId } })
        expenseByCat.set(k, { name: gl?.accountName || 'Bill expense', total: 0 })
      }
      expenseByCat.get(k)!.total += portion
      totalExpenses += portion
    }
  }

  return {
    totalIncome,
    incomeByAcct: new Map(),
    expenseByCat,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
  }
}

export async function computePL(
  start: Date,
  end: Date,
  currency: string,
  basis: 'accrual' | 'cash' = 'accrual'
): Promise<PLData> {
  // Accrual is GL-driven (and therefore CAD); cash basis uses the legacy source tables.
  return basis === 'cash'
    ? computePLCash(start, end, currency)
    : computePLFromGL(start, end)
}

export type PeriodRange = {
  start: Date
  end: Date
  /** e.g. "Nov 2024", "2025 Q1", "FY2026 Q1" */
  label: string
}

/** Which period the columns of a `PeriodPL` are cut on. */
export type PeriodKind = 'month' | 'quarter' | 'fiscal-quarter'

/**
 * Calendar periods of `months` months covering [start, end], with the first and
 * last clipped to the range so per-period figures always sum exactly to the
 * whole-range P&L. Buckets are aligned to the calendar (a 3-month period always
 * starts in Jan/Apr/Jul/Oct, never on whatever month the range happens to open
 * in).
 *
 * Edges are **UTC calendar-date instants**, matching `reportRange.ts` and
 * `fiscalYear.ts`: starts at UTC midnight, ends at 23:59:59 UTC. Building them
 * in server-local time instead would shift every column by the UTC offset on a
 * non-UTC box, sweeping the first entries of one period into the previous one.
 */
function periodRangesBetween(
  start: Date,
  end: Date,
  months: number,
  labelOf: (periodStart: Date) => string
): PeriodRange[] {
  const periods: PeriodRange[] = []
  if (end < start) return periods
  let y = start.getUTCFullYear()
  let m = start.getUTCMonth() - (start.getUTCMonth() % months)
  while (new Date(Date.UTC(y, m, 1)) <= end) {
    const periodStart = new Date(Date.UTC(y, m, 1))
    const periodEnd = new Date(Date.UTC(y, m + months, 0, 23, 59, 59))
    periods.push({
      start: periodStart < start ? start : periodStart,
      end: periodEnd > end ? end : periodEnd,
      label: labelOf(periodStart),
    })
    m += months
    if (m > 11) {
      m -= 12
      y += 1
    }
  }
  return periods
}

/** Calendar months covering [start, end], clipped at both ends. */
export function monthRangesBetween(start: Date, end: Date): PeriodRange[] {
  return periodRangesBetween(start, end, 1, (d) =>
    // timeZone: 'UTC' or a UTC-midnight instant renders as the previous month
    // on any box west of Greenwich.
    d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
  )
}

/**
 * CALENDAR quarters covering [start, end], clipped at both ends — Jan–Mar,
 * Apr–Jun, Jul–Sep, Oct–Dec regardless of the company's fiscal year end.
 *
 * That is deliberate, not an oversight: the Excise Tax Act's small-supplier and
 * registration thresholds are measured on calendar quarters (s.148 — "the four
 * calendar quarters immediately preceding"), so this series has to stay aligned
 * to the calendar even for a company with, say, an Oct 31 year-end. Use
 * `fiscalQuarterRangesBetween` for the fiscal-year-aligned series.
 */
export function quarterRangesBetween(start: Date, end: Date): PeriodRange[] {
  return periodRangesBetween(
    start,
    end,
    3,
    (d) => `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`
  )
}

/**
 * FISCAL quarters covering [start, end], clipped at both ends. Unlike the
 * calendar series these can't be cut with plain month arithmetic — the quarter
 * edges are offset by the year-end month and the day has to be clamped per
 * quarter (a Feb-29 or Apr-31 config) — so this defers to `lib/fiscalYear.ts`,
 * which guarantees the four quarters tile the fiscal year exactly.
 *
 * Ranges may span several fiscal years, so it walks (fyYear, quarter) pairs and
 * rolls over rather than enumerating within one year.
 */
export function fiscalQuarterRangesBetween(
  start: Date,
  end: Date,
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): PeriodRange[] {
  const periods: PeriodRange[] = []
  if (end < start) return periods
  let { fyYear, quarter } = fiscalQuarterOf(start, fye)
  // Each iteration moves to a strictly later quarter, so this terminates.
  for (;;) {
    const bounds = fiscalQuarterBounds(fyYear, quarter, fye)
    if (bounds.start > end) break
    periods.push({
      start: bounds.start < start ? start : bounds.start,
      end: bounds.end > end ? end : bounds.end,
      label: `FY${fyYear} Q${quarter}`,
    })
    if (quarter === 4) {
      fyYear += 1
      quarter = 1
    } else {
      quarter += 1
    }
  }
  return periods
}

export type PeriodPL = {
  kind: PeriodKind
  periods: Array<
    PeriodRange & PLData & { cumulativeNet: number; trailingFourIncome: number }
  >
  /**
   * Whole-range totals (equals the sum of the per-period figures). Its account
   * maps span the entire range, so they are exactly the union of the per-period
   * maps — which is what lets the report render one row per account with a
   * consistent set of rows across every column.
   */
  total: PLData
}

/**
 * Period-by-period P&L across [start, end] plus a running cumulative net — the
 * comparative view accountants use to pick a first fiscal year-end, and the
 * "display columns by period" layout most accounting packages offer. One
 * `computePL` call per period keeps the per-period numbers identical to what
 * the single-period report shows for that period.
 */
async function computePeriodPL(
  kind: PeriodKind,
  ranges: PeriodRange[],
  start: Date,
  end: Date,
  currency: string,
  basis: 'accrual' | 'cash'
): Promise<PeriodPL> {
  const perPeriod = await Promise.all(ranges.map((r) => computePL(r.start, r.end, currency, basis)))

  let cumulativeNet = 0
  const periods = ranges.map((r, i) => {
    cumulativeNet += perPeriod[i].netProfit
    // Trailing four = this period plus up to three preceding COLUMNS, so the
    // figure is always derivable from what's on screen. On a quarterly view
    // that's the ETA s.148 small-supplier test. It understates for the first
    // three columns of a range that opens mid-history, which is why the report
    // captions it rather than presenting it as unconditional.
    let trailingFourIncome = 0
    for (let j = Math.max(0, i - 3); j <= i; j++) trailingFourIncome += perPeriod[j].totalIncome
    return { ...r, ...perPeriod[i], cumulativeNet, trailingFourIncome }
  })

  const total = await computePL(start, end, currency, basis)
  return { kind, periods, total }
}

export async function computeMonthlyPL(
  start: Date,
  end: Date,
  currency: string,
  basis: 'accrual' | 'cash' = 'accrual'
): Promise<PeriodPL> {
  return computePeriodPL('month', monthRangesBetween(start, end), start, end, currency, basis)
}

export async function computeQuarterlyPL(
  start: Date,
  end: Date,
  currency: string,
  basis: 'accrual' | 'cash' = 'accrual'
): Promise<PeriodPL> {
  return computePeriodPL('quarter', quarterRangesBetween(start, end), start, end, currency, basis)
}

export async function computeFiscalQuarterlyPL(
  start: Date,
  end: Date,
  currency: string,
  basis: 'accrual' | 'cash' = 'accrual',
  fye: FiscalYearEnd = DEFAULT_FISCAL_YEAR_END
): Promise<PeriodPL> {
  return computePeriodPL(
    'fiscal-quarter',
    fiscalQuarterRangesBetween(start, end, fye),
    start,
    end,
    currency,
    basis
  )
}

/**
 * A rendered row of the period P&L. The screen and the CSV/Excel exports both
 * build from this, which is what guarantees a downloaded file matches the table
 * it was downloaded from.
 */
export type PeriodPLRow = {
  /** `section` is a label-only band; `memo` sits below the net line. */
  kind: 'section' | 'account' | 'subtotal' | 'net' | 'memo'
  label: string
  /** One value per column, in `PeriodPL.periods` order. Empty for `section`. */
  values: number[]
  /** The whole-range figure, or null where a total is meaningless. */
  total: number | null
  /** Render in green/red by sign. */
  signed?: boolean
}

/**
 * The full statement laid out as header + rows: income accounts, expense
 * accounts, the net line, and the running memos beneath it.
 */
export function buildPeriodPLRows(data: PeriodPL): { headers: string[]; rows: PeriodPLRow[] } {
  const { periods, total } = data
  const headers = ['', ...periods.map((p) => p.label), 'Total']

  const accountRows = (
    pick: (d: PLData) => Map<string, { name: string; total: number }>
  ): PeriodPLRow[] =>
    Array.from(pick(total).entries()).map(([key, acct]) => ({
      kind: 'account' as const,
      label: acct.name,
      values: periods.map((p) => pick(p).get(key)?.total ?? 0),
      total: acct.total,
    }))

  // Cash basis carries no GL breakdown of income, so it collapses to one line —
  // the same treatment the single-column statement gives it.
  const incomeRows: PeriodPLRow[] =
    total.incomeByAcct.size > 0
      ? accountRows((d) => d.incomeByAcct)
      : [
          {
            kind: 'account',
            label: 'Sales & Services',
            values: periods.map((p) => p.totalIncome),
            total: total.totalIncome,
          },
        ]

  const rows: PeriodPLRow[] = [
    { kind: 'section', label: 'Income', values: [], total: null },
    ...incomeRows,
    {
      kind: 'subtotal',
      label: 'Total Income',
      values: periods.map((p) => p.totalIncome),
      total: total.totalIncome,
    },
    { kind: 'section', label: 'Expenses', values: [], total: null },
    ...accountRows((d) => d.expenseByCat),
    {
      kind: 'subtotal',
      label: 'Total Expenses',
      values: periods.map((p) => p.totalExpenses),
      total: total.totalExpenses,
    },
    {
      kind: 'net',
      label: 'Net Profit',
      values: periods.map((p) => p.netProfit),
      total: total.netProfit,
      signed: true,
    },
    // Cumulative net is a running figure, so a "total" column would just repeat
    // the last cell.
    {
      kind: 'memo',
      label: 'Cumulative Net',
      values: periods.map((p) => p.cumulativeNet),
      total: null,
      signed: true,
    },
  ]

  if (data.kind !== 'month') {
    rows.push({
      kind: 'memo',
      label: 'Trailing 4 Quarters (Income)',
      values: periods.map((p) => p.trailingFourIncome),
      total: null,
    })
  }

  return { headers, rows }
}
