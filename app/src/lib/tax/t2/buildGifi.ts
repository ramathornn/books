/**
 * buildGifi — the DB adapter that feeds the pure computeGifi engine.
 *
 * Responsibilities (the I/O + mapping layer):
 *  - Load the GL chart and compute balances AS-OF the fiscal year-end, EXCLUDING
 *    kind='closing' journal entries so the income/expense detail is the real
 *    PRE-CLOSE P&L (blocker 2). balancesAsOf cannot be reused directly because it
 *    includes every posted entry; we re-implement the same class-normal sign
 *    convention here while filtering closing entries out.
 *  - Map account.gifiCode → GIFI detail line; aggregate by code.
 *  - Source dividends declared (GIFI 3700) by summing POSTED journal-entry DEBITS
 *    to CompanySettings.dividendsDeclaredAccountId in the fiscal window — the SAME
 *    single source computeT5 uses (blocker 1). buildGifi only needs the TOTAL
 *    declared; the eligible/non-eligible split is the dividend pull's job.
 *  - Gate: a non-CAD account with a non-zero balance → ERROR; an unmapped (no
 *    gifiCode) account with a non-zero balance → ERROR.
 *  - Emit pulledRefs provenance for the rolled detail lines + dividends declared.
 *
 * Then hands the assembled details to computeGifi (subtotals, plug, gates).
 */

import prisma from '@/lib/prisma'
import { roundDollar } from '@/lib/tax/round'
import { computeGifi, type GifiDetailBalance } from '@/lib/tax/t2/computeGifi'
import {
  GIFI_DIVIDENDS_DECLARED,
  GIFI_RETAINED_EARNINGS,
} from '@/lib/tax/t2/gifiCodes'
import type {
  GifiResult,
  PulledRef,
  PulledRefs,
  ValidationIssue,
} from '@/lib/tax/t2/types'

/** GL account row shape needed for the GIFI roll-up. */
interface GifiAccount {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
  currency: string
  gifiCode: string | null
  openingBalance: number
  openingBalanceDate: Date | null
}

export interface BuildGifiInput {
  /** inclusive fiscal year-end (balances computed as-of end-of-day). */
  fiscalYearEnd: Date
  /** inclusive fiscal year-start (closing-entry window + warn detection). */
  fiscalYearStart: Date
  /** retained earnings, opening (from the continuity record). */
  retainedEarningsOpening: number
  /** configured dividends-declared GL account id (null ⇒ no dividends sourced). */
  dividendsDeclaredAccountId: string | null
}

export interface BuildGifiResult extends GifiResult {
  pulledRefs: PulledRefs
}

/**
 * Compute class-normal balances as-of `asOf`, EXCLUDING kind='closing' entries.
 * Mirrors lib/glBalances.balancesAsOf's sign convention exactly (asset/expense
 * debit-normal; liability/equity/income credit-normal) but filters the closing
 * entries the year-end roll would otherwise fold in (blocker 2).
 */
async function preCloseBalances(
  accounts: GifiAccount[],
  asOf: Date,
): Promise<{ balances: Map<string, number>; lineIdsByAccount: Map<string, string[]> }> {
  const balances = new Map<string, number>()
  const lineIdsByAccount = new Map<string, string[]>()
  if (accounts.length === 0) return { balances, lineIdsByAccount }

  const byId = new Map(accounts.map((a) => [a.id, a]))
  for (const a of accounts) {
    let bal = Number(a.openingBalance)
    if (a.openingBalanceDate && a.openingBalanceDate > asOf) bal = 0
    balances.set(a.id, bal)
    lineIdsByAccount.set(a.id, [])
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: { in: accounts.map((a) => a.id) },
      journalEntry: {
        status: 'posted',
        entryDate: { lte: asOf },
        kind: { not: 'closing' }, // PRE-CLOSE (blocker 2)
      },
    },
    select: { id: true, glAccountId: true, debit: true, credit: true },
  })

  for (const l of lines) {
    const a = byId.get(l.glAccountId)
    if (!a) continue
    const debitNormal = a.accountClass === 'asset' || a.accountClass === 'expense'
    const delta = debitNormal
      ? Number(l.debit) - Number(l.credit)
      : Number(l.credit) - Number(l.debit)
    balances.set(a.id, (balances.get(a.id) || 0) + delta)
    lineIdsByAccount.get(a.id)!.push(l.id)
  }

  return { balances, lineIdsByAccount }
}

/**
 * Sum POSTED journal-entry DEBITS to the dividends-declared account within the
 * fiscal window — the SAME single source computeT5 uses (blocker 1). Returns the
 * whole-dollar total + the consumed JE line ids for provenance.
 */
async function dividendsDeclaredInWindow(
  accountId: string | null,
  start: Date,
  end: Date,
): Promise<{ total: number; lineIds: string[] }> {
  if (!accountId) return { total: 0, lineIds: [] }
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: accountId,
      journalEntry: { status: 'posted', entryDate: { gte: start, lte: end } },
    },
    select: { id: true, debit: true },
  })
  let total = 0
  const lineIds: string[] = []
  for (const l of lines) {
    total += Number(l.debit || 0)
    lineIds.push(l.id)
  }
  return { total: roundDollar(total), lineIds }
}

/** True when a kind='closing' entry is already posted in the fiscal window. */
async function hasClosingEntry(start: Date, end: Date): Promise<boolean> {
  const found = await prisma.journalEntry.findFirst({
    where: { status: 'posted', kind: 'closing', entryDate: { gte: start, lte: end } },
    select: { id: true },
  })
  return found !== null
}

/**
 * Build the GIFI roll-up from the live GL. Pulls balances, maps GIFI codes,
 * sources dividends declared, runs the non-CAD + unmapped gates, then delegates
 * subtotals/plug/balance-gates to the pure computeGifi.
 */
export async function buildGifi(input: BuildGifiInput): Promise<BuildGifiResult> {
  const {
    fiscalYearEnd,
    fiscalYearStart,
    retainedEarningsOpening,
    dividendsDeclaredAccountId,
  } = input

  const issues: ValidationIssue[] = []

  const accountsRaw = await prisma.gLAccount.findMany({
    where: { isActive: true },
    select: {
      id: true,
      accountNumber: true,
      accountName: true,
      accountClass: true,
      currency: true,
      gifiCode: true,
      openingBalance: true,
      openingBalanceDate: true,
    },
  })
  const accounts: GifiAccount[] = accountsRaw.map((a) => ({
    id: a.id,
    accountNumber: a.accountNumber,
    accountName: a.accountName,
    accountClass: a.accountClass,
    currency: a.currency,
    gifiCode: a.gifiCode,
    openingBalance: Number(a.openingBalance),
    openingBalanceDate: a.openingBalanceDate,
  }))

  const { balances, lineIdsByAccount } = await preCloseBalances(accounts, fiscalYearEnd)

  // ── Map gifiCode → detail; run the non-CAD + unmapped gates ──
  const detailByCode = new Map<string, GifiDetailBalance>()
  const refsByCode = new Map<string, PulledRef>()

  for (const a of accounts) {
    const bal = roundDollar(balances.get(a.id) ?? 0)
    if (bal === 0) continue // zero balance: nothing to roll, no gate fires

    // Non-CAD non-zero balance → ERROR (v1 is CAD-only; no FX translation).
    if (a.currency !== 'CAD') {
      issues.push({
        level: 'error',
        code: 'GIFI_NON_CAD_BALANCE',
        message: `Account ${a.accountNumber} "${a.accountName}" holds a non-zero ${a.currency} balance (${bal}); v1 GIFI is CAD-only and cannot translate foreign-currency balances.`,
        accountId: a.id,
      })
      continue
    }

    // Unmapped (no GIFI code) non-zero balance → ERROR.
    if (!a.gifiCode) {
      issues.push({
        level: 'error',
        code: 'GIFI_UNMAPPED_ACCOUNT',
        message: `Account ${a.accountNumber} "${a.accountName}" has a non-zero balance (${bal}) but no GIFI code mapped; map it before preparing the T2.`,
        accountId: a.id,
      })
      continue
    }

    const code = a.gifiCode
    const cur = detailByCode.get(code) ?? { code, amount: 0, accountIds: [] }
    cur.amount = roundDollar(cur.amount + bal)
    cur.accountIds.push(a.id)
    detailByCode.set(code, cur)

    const ref = refsByCode.get(code) ?? { source: 'GL', ids: [], total: 0 }
    ref.ids.push(...(lineIdsByAccount.get(a.id) ?? []))
    ref.total = roundDollar(ref.total + bal)
    refsByCode.set(code, ref)
  }

  // ── Dividends declared (GIFI 3700) — mirror computeT5's single source ──
  const start = startOfDay(fiscalYearStart)
  const end = endOfDay(fiscalYearEnd)
  const divs = await dividendsDeclaredInWindow(dividendsDeclaredAccountId, start, end)
  const closingEntryPosted = await hasClosingEntry(start, end)

  // ── Delegate to the pure engine ──
  const result = computeGifi({
    details: Array.from(detailByCode.values()),
    retainedEarningsOpening,
    dividendsDeclared: divs.total,
    closingEntryPosted,
  })

  // Prepend the adapter-level gate issues (non-CAD / unmapped) ahead of the
  // engine's balance gates.
  result.issues = [...issues, ...result.issues]

  // ── pulledRefs provenance ──
  const pulledRefs: PulledRefs = {}
  for (const [code, ref] of refsByCode) {
    if (code === GIFI_RETAINED_EARNINGS) continue // RE is continuity-derived, not pulled
    pulledRefs[`GIFI:${code}`] = ref
  }
  if (divs.lineIds.length > 0 || divs.total !== 0) {
    pulledRefs[`GIFI:${GIFI_DIVIDENDS_DECLARED}`] = {
      source: 'JE',
      ids: divs.lineIds,
      total: divs.total,
    }
  }

  return { ...result, pulledRefs }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}
