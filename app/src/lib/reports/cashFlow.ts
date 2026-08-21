import prisma from '@/lib/prisma'
import { balancesAsOf } from '@/lib/glBalances'
import { ACCOUNT_TYPES, getTypeForDetailType } from '@/lib/accountTypes'

/**
 * Statement of Cash Flows (INDIRECT METHOD), derived entirely from the GL.
 *
 * Accrual-only. Sections: Operating → Investing → Financing, one row per
 * balance-sheet GL account (its period delta), with a footer reconciling to
 * cash at beginning and end of the period.
 *
 * WHY THIS TIES (the correctness core):
 * Over any period, posted double entry gives Σ over ALL accounts of
 * (credit − debit) = 0. Split the accounts into three groups —
 * {cash, non-cash balance-sheet, income/expense}:
 *
 *   Δcash(debit-normal) = Σ non-cash BS (credit − debit) + Σ income/expense (credit − debit)
 *
 * For a non-cash ASSET, (credit − debit) = −deltaNatural; for a LIABILITY or
 * EQUITY account, = +deltaNatural; for income/expense the period sum IS net
 * income — the Operating section's starting line. So summing net income plus
 * each non-cash BS account's signed delta reproduces the change in cash exactly.
 *
 * CLOSING ENTRIES: a fiscal-year close (kind='closing') is a zero-sum shuffle
 * among {income, expense, retained earnings}. We exclude those JEs from
 * `netIncome` AND net them out of the equity deltas (`closingEquityDeltas`).
 * Removing a zero-sum set from both places means net income is counted exactly
 * once whether or not the period spans a year-end close.
 *
 * RESIDUAL DISCREPANCY can arise only from `openingBalance` values whose
 * `openingBalanceDate` falls strictly inside (start, end] — they enter
 * `endBalances` with no offsetting JE (a limitation inherited from
 * `balancesAsOf`, shared by the Balance Sheet). We render it as a warning;
 * we never hide it.
 *
 * DELIBERATE DIVERGENCES FROM COMMON PACKAGE DEFAULTS (all documented in the classifier):
 *  - D&A addback is shown in Operating (some packages bury accumulated-depreciation
 *    deltas in Investing — not GAAP).
 *  - Per-account `cashFlowSection` override ("classify cash" override, as desktop packages offer).
 *  - Non-trade loan detail types default to Financing/Investing, not Operating.
 *
 * kind notes:
 *  - kind='dividend' (DR Retained Earnings / CR payable): no special handling —
 *    the RE delta lands in Financing (declaration), the payable delta offsets in
 *    Operating until paid. Standard indirect-method behaviour.
 *  - kind='fx-reval' posts unrealized FX against a P&L account, so FX effects are
 *    already inside net income → Operating. There is no separate "Effect of
 *    exchange rate changes on cash" line in v1. v2 path (per IAS 7.28 / ASPE
 *    1540.28): split fx-reval lines that hit cash-bucket accounts into a
 *    dedicated statement line.
 *  - kind='reversal' / voided JEs: reversals are posted JEs whose two sides net
 *    out — no handling needed.
 */

export type CashFlowSection = 'operating' | 'investing' | 'financing'
/** Where an account's period delta lands: a section, the cash boundary, or the D&A addback group. */
export type CashFlowBucket = CashFlowSection | 'cash' | 'depreciationAddback'

/** Minimal account shape the pure classifier needs (keeps tests DB-free). */
export type CashFlowAccountLike = {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
  accountSubclass: string
  detailType: string
  cashFlowSection: string | null
  hasBankAccount: boolean          // bankAccount relation non-null
  bankAccountType: string | null   // BankAccount.accountType when linked
}

export type CashFlowRow = {
  accountId: string
  accountNumber: string
  accountName: string
  /** Signed cash-flow contribution for the period; positive = cash inflow. */
  amount: number
}

export type CashFlowStatement = {
  netIncome: number
  depreciationRows: CashFlowRow[]   // non-cash addbacks (part of Operating)
  operatingRows: CashFlowRow[]      // changes in operating assets and liabilities
  operatingTotal: number            // netIncome + Σ depreciationRows + Σ operatingRows
  investingRows: CashFlowRow[]
  investingTotal: number
  financingRows: CashFlowRow[]
  financingTotal: number
  netCashChange: number             // sum of the three totals — ties by construction
  cashAtStart: number               // independently computed from cash-account balances
  cashAtEnd: number
  /** (cashAtEnd − cashAtStart) − netCashChange. |x| > 0.01 → page renders a warning. */
  discrepancy: number
}

export type CashFlowInputs = {
  accounts: CashFlowAccountLike[]              // ALL accounts, all 5 classes (see computeCashFlowFromGL)
  startBalances: Map<string, number>           // balancesAsOf at (start − 1ms), positive-normal
  endBalances: Map<string, number>             // balancesAsOf at end
  netIncome: number                            // period P&L excluding kind='closing' JEs
  closingEquityDeltas: Map<string, number>     // per equity account: (credit−debit) from kind='closing' JEs in period
}

export type CashTransactionRow = {
  date: Date
  entryNumber: string
  description: string
  accountName: string   // the cash account the line hits
  inflow: number        // line debit
  outflow: number       // line credit
}

/** Round to cents. Same rounding as fiscalYearClose.ts. */
const r2 = (n: number) => Math.round(n * 100) / 100

// Maps lowercased type labels AND seed-vocabulary aliases → canonical Type label.
const TYPE_LOOKUP = new Map<string, string>()
for (const t of ACCOUNT_TYPES) TYPE_LOOKUP.set(t.type.toLowerCase(), t.type)
// Seed vocabulary (scripts/seed-accounting.ts) where it differs from the canonical label:
TYPE_LOOKUP.set('accounts receivable', 'Accounts receivable (A/R)')
TYPE_LOOKUP.set('accounts payable', 'Accounts payable (A/P)')
// 'current assets', 'property, plant and equipment', 'bank', 'credit card',
// 'other current liabilities', 'long-term liabilities', 'equity' already match case-insensitively.

/** Resolve the account's canonical Type label from either metadata vocabulary, or null. */
export function accountTypeOf(a: Pick<CashFlowAccountLike, 'accountSubclass' | 'detailType'>): string | null {
  // Fine detail type (e.g. 'Chequing') → its Type, when it is a known detail type.
  const byDetail = getTypeForDetailType(a.detailType)
  if (byDetail) return byDetail.type
  // Otherwise the detailType or accountSubclass may itself hold a Type label.
  return (
    TYPE_LOOKUP.get(a.detailType.toLowerCase()) ??
    TYPE_LOOKUP.get(a.accountSubclass.toLowerCase()) ??
    null
  )
}

/** Total function: every account maps to exactly one bucket. */
export function classifyCashFlowBucket(a: CashFlowAccountLike): CashFlowBucket {
  // 1. P&L guard — income/expense are represented by net income, never as delta
  //    rows, but keeping the function total tolerates the legacy 'Revenue' subclass.
  if (a.accountClass === 'income' || a.accountClass === 'expense') return 'operating'

  // 2. Cash boundary (asset class only; wins over the override so a cash account
  //    can never be reclassified out of the cash boundary).
  if (
    a.accountClass === 'asset' &&
    ((a.hasBankAccount && a.bankAccountType !== 'credit_card') || accountTypeOf(a) === 'Bank')
  ) {
    // Covers seed/form subclass 'Bank', the Bank fine detail types, and any
    // Plaid/CSV-linked bank account. Only Bank-type accounts are
    // cash. Undeposited-funds/clearing accounts typed 'Current assets' are
    // Operating — a business that wants a clearing account inside cash links a
    // BankAccount row or sets its type to Bank (data, not code).
    return 'cash'
  }

  // 3. Per-account override.
  if (
    a.cashFlowSection === 'operating' ||
    a.cashFlowSection === 'investing' ||
    a.cashFlowSection === 'financing'
  ) {
    return a.cashFlowSection
  }

  // 4. D&A addback (asset class only): the contra-asset credit delta IS the
  //    period's D&A expense — an Operating non-cash addback, not Investing.
  //    Covers all four contra detail types (the '^'-anchored regex matches
  //    'Accumulated Amortization of Other Assets' too).
  if (
    a.accountClass === 'asset' &&
    (/^accumulated (depreciation|amortization|depletion)/i.test(a.detailType) ||
      /accumulated\s+(depreciation|amortization|depletion)/i.test(a.accountName))
  ) {
    return 'depreciationAddback'
  }

  // 5. Non-trade loan detail types (fine detailType only; machine-written values
  //    from ACCOUNT_TYPES, so compare case-sensitively). Fixes the common
  //    default (short-term borrowings landing in Operating).
  if (
    a.detailType === 'Loans To Officers' ||
    a.detailType === 'Loans to Others' ||
    a.detailType === 'Loans to Shareholders'
  ) {
    return 'investing'
  }
  if (
    a.detailType === 'Line of Credit' ||
    a.detailType === 'Loan Payable' ||
    a.detailType === 'Short term borrowings from related parties'
  ) {
    return 'financing'
  }

  // 6. Type mapping.
  switch (accountTypeOf(a)) {
    case 'Accounts receivable (A/R)':
    case 'Current assets':
      return 'operating'
    case 'Property, plant and equipment':
    case 'Long-term Assets':
      return 'investing'
    case 'Credit Card':
    case 'Accounts payable (A/P)':
    case 'Other Current Liabilities':
      return 'operating'
    case 'Long-term Liabilities':
      return 'financing'
    case 'Equity':
      return 'financing'
  }

  // 7. Class default (total fallthrough). Unknown balance-sheet
  //    accounts default to Operating. No "Unclassified" section — the override
  //    is the escape hatch, and the classifier being total means the tie-out
  //    identity always covers every account.
  return a.accountClass === 'equity' ? 'financing' : 'operating'
}

/** Assemble the statement from period balances + net income. Pure — no prisma. */
export function assembleCashFlowStatement(inputs: CashFlowInputs): CashFlowStatement {
  const { accounts, startBalances, endBalances, closingEquityDeltas } = inputs
  const netIncome = r2(inputs.netIncome)

  const depreciationRows: CashFlowRow[] = []
  const operatingRows: CashFlowRow[] = []
  const investingRows: CashFlowRow[] = []
  const financingRows: CashFlowRow[] = []

  let cashAtStart = 0
  let cashAtEnd = 0

  for (const a of accounts) {
    const bucket = classifyCashFlowBucket(a)

    if (bucket === 'cash') {
      cashAtStart += startBalances.get(a.id) ?? 0
      cashAtEnd += endBalances.get(a.id) ?? 0
      continue
    }

    // Only balance-sheet accounts produce delta rows; income/expense are net income.
    if (
      a.accountClass !== 'asset' &&
      a.accountClass !== 'liability' &&
      a.accountClass !== 'equity'
    ) {
      continue
    }

    const deltaNatural = (endBalances.get(a.id) ?? 0) - (startBalances.get(a.id) ?? 0) // positive-normal
    const adjusted =
      a.accountClass === 'equity'
        ? deltaNatural - (closingEquityDeltas.get(a.id) ?? 0)
        : deltaNatural
    const contribution = a.accountClass === 'asset' ? -adjusted : adjusted // inflow positive
    const amount = r2(contribution)
    if (amount === 0) continue // round first, then drop, so rows re-add to totals exactly

    const row: CashFlowRow = {
      accountId: a.id,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      amount,
    }
    if (bucket === 'depreciationAddback') depreciationRows.push(row)
    else if (bucket === 'investing') investingRows.push(row)
    else if (bucket === 'financing') financingRows.push(row)
    else operatingRows.push(row) // 'operating'
  }

  const byNumber = (x: CashFlowRow, y: CashFlowRow) =>
    x.accountNumber < y.accountNumber ? -1 : x.accountNumber > y.accountNumber ? 1 : 0
  depreciationRows.sort(byNumber)
  operatingRows.sort(byNumber)
  investingRows.sort(byNumber)
  financingRows.sort(byNumber)

  const sum = (rows: CashFlowRow[]) => rows.reduce((s, x) => s + x.amount, 0)
  const operatingTotal = r2(netIncome + sum(depreciationRows) + sum(operatingRows))
  const investingTotal = r2(sum(investingRows))
  const financingTotal = r2(sum(financingRows))
  const netCashChange = r2(operatingTotal + investingTotal + financingTotal)
  cashAtStart = r2(cashAtStart)
  cashAtEnd = r2(cashAtEnd)
  const discrepancy = r2(cashAtEnd - cashAtStart - netCashChange)

  return {
    netIncome,
    depreciationRows,
    operatingRows,
    operatingTotal,
    investingRows,
    investingTotal,
    financingRows,
    financingTotal,
    netCashChange,
    cashAtStart,
    cashAtEnd,
    discrepancy,
  }
}

// ---------------------------------------------------------------------------
// DB wrappers (below the pure functions, mirroring profitAndLoss.ts).
// ---------------------------------------------------------------------------

/** Fetch ALL accounts and map to the classifier's shape. */
async function fetchCashFlowAccounts() {
  // No isArchived filter, no currency filter: the statement is a period-activity
  // reconciliation that must be COMPLETE to tie. An archived account can still
  // hold posted lines in the period (archiving happens instead of deletion
  // whenever lines exist), and GL postings are CAD amounts regardless of the
  // account's currency label (same stance as computePLFromGL). This deliberately
  // differs from the Balance Sheet / Trial Balance, which filter both — they are
  // point-in-time listings, not activity reconciliations.
  const accounts = await prisma.gLAccount.findMany({
    select: {
      id: true, accountNumber: true, accountName: true, accountClass: true,
      accountSubclass: true, detailType: true, cashFlowSection: true,
      openingBalance: true, openingBalanceDate: true,
      bankAccount: { select: { accountType: true } },
    },
    orderBy: { accountNumber: 'asc' },
  })
  const likes: CashFlowAccountLike[] = accounts.map((a) => ({
    id: a.id,
    accountNumber: a.accountNumber,
    accountName: a.accountName,
    accountClass: a.accountClass,
    accountSubclass: a.accountSubclass,
    detailType: a.detailType,
    cashFlowSection: a.cashFlowSection,
    hasBankAccount: !!a.bankAccount,
    bankAccountType: a.bankAccount?.accountType ?? null,
  }))
  return { accounts, likes }
}

export async function computeCashFlowFromGL(start: Date, end: Date): Promise<CashFlowStatement> {
  const startMinus = new Date(start.getTime() - 1) // one ms before period start (prior day 23:59:59.999)

  const { accounts, likes } = await fetchCashFlowAccounts()

  // Balances only for the balance-sheet classes (the ones that produce deltas / cash).
  const bs = accounts.filter(
    (a) => a.accountClass === 'asset' || a.accountClass === 'liability' || a.accountClass === 'equity'
  )
  const startBalances = await balancesAsOf(bs, startMinus)
  const endBalances = await balancesAsOf(bs, end)

  // Net income, excluding closing entries (do NOT reuse computePLFromGL — it
  // does not exclude kind='closing'; leave profitAndLoss.ts untouched).
  const plLines = await prisma.journalEntryLine.findMany({
    where: {
      glAccount: { accountClass: { in: ['income', 'expense'] } },
      journalEntry: { status: 'posted', kind: { not: 'closing' }, entryDate: { gte: start, lte: end } },
    },
    select: { debit: true, credit: true, glAccount: { select: { accountClass: true } } },
  })
  let netIncome = 0
  for (const l of plLines) {
    const debit = Number(l.debit)
    const credit = Number(l.credit)
    // income − expenses, expressed per line: income = credit−debit, expense = −(debit−credit).
    netIncome += l.glAccount.accountClass === 'income' ? credit - debit : -(debit - credit)
  }

  // Closing equity deltas: (credit − debit) per equity account from kind='closing' JEs.
  const closingLines = await prisma.journalEntryLine.findMany({
    where: {
      glAccount: { accountClass: 'equity' },
      journalEntry: { status: 'posted', kind: 'closing', entryDate: { gte: start, lte: end } },
    },
    select: { glAccountId: true, debit: true, credit: true },
  })
  const closingEquityDeltas = new Map<string, number>()
  for (const l of closingLines) {
    const delta = Number(l.credit) - Number(l.debit)
    closingEquityDeltas.set(l.glAccountId, (closingEquityDeltas.get(l.glAccountId) ?? 0) + delta)
  }

  return assembleCashFlowStatement({ accounts: likes, startBalances, endBalances, netIncome, closingEquityDeltas })
}

export async function listCashTransactions(start: Date, end: Date): Promise<CashTransactionRow[]> {
  const { likes } = await fetchCashFlowAccounts()
  const cashIds = new Set(likes.filter((a) => classifyCashFlowBucket(a) === 'cash').map((a) => a.id))
  if (cashIds.size === 0) return []

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: { in: [...cashIds] },
      journalEntry: { status: 'posted', entryDate: { gte: start, lte: end } },
    },
    select: {
      debit: true, credit: true, description: true,
      glAccount: { select: { accountName: true } },
      journalEntry: {
        select: {
          entryNumber: true, entryDate: true, description: true,
          lines: { select: { glAccountId: true } },
        },
      },
    },
    orderBy: { journalEntry: { entryDate: 'asc' } },
  })

  const out: CashTransactionRow[] = []
  for (const l of lines) {
    // Skip pure bank↔bank transfers: every line of the parent JE hits a cash
    // account, so it nets to zero inside the cash boundary. A transfer JE that
    // also carries a fee line is NOT pure and stays visible (correctly).
    const je = l.journalEntry
    if (je.lines.every((x) => cashIds.has(x.glAccountId))) continue
    out.push({
      date: je.entryDate,
      entryNumber: je.entryNumber,
      description: l.description || je.description || '—',
      accountName: l.glAccount.accountName,
      inflow: Number(l.debit),
      outflow: Number(l.credit),
    })
  }
  return out
}
