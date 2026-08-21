/**
 * computeGifi — the PURE GIFI roll-up engine.
 *
 * Given the per-code DETAIL balances already extracted from the GL (the leaf
 * S100/S125 lines, keyed by GIFI code) plus the continuity figures (retained
 * earnings opening, dividends declared) this function:
 *
 *  1. COMPUTES every subtotal/total in-engine (2599, 3499, 3620, 3640, 8299,
 *     9368, 9970, 9999) — blocker 5: never trust a seeded subtotal code.
 *  2. Derives net income PRE-CLOSE (9999) from the revenue/expense detail and the
 *     book tax provision (9990). The DB adapter (buildGifi.ts) is responsible for
 *     excluding kind='closing' entries so the income/expense detail is the real
 *     pre-close P&L — blocker 2.
 *  3. Computes retained-earnings-end (3600) = RE-start + netIncome − dividends
 *     declared, then applies a whole-dollar rounding PLUG to RE so the balance
 *     identity 2599 = 3499 + 3620 survives independent whole-dollar rounding of
 *     the two sides.
 *  4. Runs the NetFile balance gates (2599 = 3499 + 3620; 3640 = 2599;
 *     3680 = 9999 i.e. RE-end reconciles to the equity-side RE; RE continuity).
 *
 * Pure: no I/O, fully deterministic over its inputs.
 */

import { roundDollar } from '@/lib/tax/round'
import {
  GIFI_LIBRARY,
  gifiDef,
  GIFI_RETAINED_EARNINGS,
  GIFI_TOTAL_ASSETS,
  GIFI_TOTAL_LIABILITIES,
  GIFI_TOTAL_EQUITY,
  GIFI_TOTAL_LIAB_AND_EQUITY,
  GIFI_DIVIDENDS_DECLARED,
  GIFI_NET_INCOME_AFTER_TAX,
  GIFI_TOTAL_REVENUE,
  GIFI_TOTAL_EXPENSES,
  GIFI_NET_BEFORE_TAX,
  GIFI_TAX_PROVISION,
  GIFI_ROUNDING_PLUG_CODE,
} from '@/lib/tax/t2/gifiCodes'
import type { GifiLine, GifiResult, ValidationIssue } from '@/lib/tax/t2/types'

/** The set of subtotal/total codes the engine OWNS — never sourced from a leaf. */
const COMPUTED_CODES: ReadonlySet<string> = new Set([
  GIFI_TOTAL_ASSETS, // 2599
  GIFI_TOTAL_LIABILITIES, // 3499
  GIFI_TOTAL_EQUITY, // 3620
  GIFI_TOTAL_LIAB_AND_EQUITY, // 3640
  GIFI_TOTAL_REVENUE, // 8299
  GIFI_TOTAL_EXPENSES, // 9368
  GIFI_NET_BEFORE_TAX, // 9970
  GIFI_NET_INCOME_AFTER_TAX, // 9999
])

/** A single detail (leaf) balance fed into the roll-up. */
export interface GifiDetailBalance {
  /** 4-digit GIFI code this account maps to. */
  code: string
  /** whole-dollar balance, class-normal sign (asset/expense debit-normal etc.). */
  amount: number
  /** GL account ids that fed this code (provenance). */
  accountIds: string[]
}

/** Inputs to the pure GIFI engine. */
export interface ComputeGifiInput {
  /** DETAIL balances only — subtotal codes here are IGNORED (computed in-engine). */
  details: GifiDetailBalance[]
  /** retained earnings, opening (prior year filed/continuity 3600). */
  retainedEarningsOpening: number
  /** dividends declared in the fiscal window (GIFI 3700; from the dividend pull). */
  dividendsDeclared: number
  /** true when a kind='closing' entry is already posted in the window (warn). */
  closingEntryPosted: boolean
}

/** Sum the detail amounts for one GIFI code; returns 0 when absent. */
function sumCode(byCode: Map<string, { amount: number; accountIds: string[] }>, code: string): number {
  return byCode.get(code)?.amount ?? 0
}

/** Σ over every detail code on a schedule that is NOT itself a computed subtotal. */
function sumSchedule(
  byCode: Map<string, { amount: number; accountIds: string[] }>,
  schedule: 'S100' | 'S125',
  predicate: (code: string) => boolean,
): number {
  let total = 0
  for (const [code, v] of byCode) {
    if (COMPUTED_CODES.has(code)) continue
    const def = gifiDef(code)
    const sched = def?.schedule ?? (Number(code) < 3700 || code === GIFI_DIVIDENDS_DECLARED ? 'S100' : 'S125')
    if (sched !== schedule) continue
    if (!predicate(code)) continue
    total += v.amount
  }
  return total
}

/**
 * Roll detail balances into a full GIFI result with engine-computed subtotals,
 * the rounding plug, and the balance gates. Pure.
 */
export function computeGifi(input: ComputeGifiInput): GifiResult {
  const { details, retainedEarningsOpening, dividendsDeclared, closingEntryPosted } = input
  const issues: ValidationIssue[] = []

  // ── Collapse details by code (ignore any subtotal codes that slipped in) ──
  const byCode = new Map<string, { amount: number; accountIds: string[] }>()
  for (const d of details) {
    if (COMPUTED_CODES.has(d.code)) continue // engine owns these
    const cur = byCode.get(d.code) ?? { amount: 0, accountIds: [] }
    cur.amount = roundDollar(cur.amount + roundDollar(d.amount))
    cur.accountIds.push(...d.accountIds)
    byCode.set(d.code, cur)
  }

  // ── S125 income statement subtotals (PRE-CLOSE) ──
  // Revenue codes: S125, 8000–8299 range (below the total-revenue subtotal).
  const totalRevenue = sumSchedule(byCode, 'S125', (c) => Number(c) < Number(GIFI_TOTAL_REVENUE))
  // Operating expenses: S125 above revenue, below the tax provision (9368/9990/9999).
  const totalExpenses = sumSchedule(
    byCode,
    'S125',
    (c) => Number(c) > Number(GIFI_TOTAL_REVENUE) && Number(c) < Number(GIFI_TOTAL_EXPENSES),
  )
  const netBeforeTax = roundDollar(totalRevenue - totalExpenses)
  const taxProvision = sumCode(byCode, GIFI_TAX_PROVISION) // 9990 (book tax expense)
  const netIncome9999 = roundDollar(netBeforeTax - taxProvision)

  // ── S100 balance sheet subtotals ──
  // Assets: S100 codes below total-assets (2599).
  const totalAssets = sumSchedule(byCode, 'S100', (c) => Number(c) < Number(GIFI_TOTAL_ASSETS))
  // Liabilities: S100 codes strictly between 2599 and total-liabilities (3499).
  const totalLiabilities = sumSchedule(
    byCode,
    'S100',
    (c) => Number(c) > Number(GIFI_TOTAL_ASSETS) && Number(c) < Number(GIFI_TOTAL_LIABILITIES),
  )

  // ── Equity (3620): share capital + computed retained earnings end ──
  // Equity detail codes (S100, > 3499, < 3620) EXCEPT retained earnings, which we
  // recompute from continuity so the closing entry can't corrupt it (blocker 2).
  const equityExRe = sumSchedule(
    byCode,
    'S100',
    (c) =>
      Number(c) > Number(GIFI_TOTAL_LIABILITIES) &&
      Number(c) < Number(GIFI_TOTAL_EQUITY) &&
      c !== GIFI_RETAINED_EARNINGS,
  )

  // Retained earnings END (3600) from continuity, PRE-PLUG.
  const reEndRaw = roundDollar(retainedEarningsOpening + netIncome9999 - dividendsDeclared)
  const totalEquityRaw = roundDollar(equityExRe + reEndRaw)

  // ── Rounding plug (blocker 5): keep 2599 = 3499 + 3620 exactly ──
  // The two sides were rounded independently; the residual is absorbed into
  // retained earnings (3600), the designated plug home.
  const targetEquity = roundDollar(totalAssets - totalLiabilities)
  const roundingPlug = roundDollar(targetEquity - totalEquityRaw)
  const reEnd = roundDollar(reEndRaw + roundingPlug)
  const totalEquity = roundDollar(totalEquityRaw + roundingPlug)
  const totalLiabAndEquity = roundDollar(totalLiabilities + totalEquity)

  // ── Assemble the line map ──
  const lines: Record<string, GifiLine> = {}
  const put = (
    code: string,
    amount: number,
    accountIds: string[],
    computed: boolean,
  ): void => {
    const def = gifiDef(code)
    lines[code] = {
      code,
      schedule: def?.schedule ?? (Number(code) < 8000 ? 'S100' : 'S125'),
      label: def?.label ?? GIFI_LIBRARY[code]?.label ?? `GIFI ${code}`,
      amount: roundDollar(amount),
      accountIds,
      computed,
    }
  }

  // Detail lines (everything pulled), with retained-earnings overridden to the
  // continuity-derived + plugged value so the equity side is internally consistent.
  for (const [code, v] of byCode) {
    if (code === GIFI_RETAINED_EARNINGS) continue // emitted below from continuity
    put(code, v.amount, v.accountIds, false)
  }
  const reAccountIds = byCode.get(GIFI_RETAINED_EARNINGS)?.accountIds ?? []
  put(GIFI_RETAINED_EARNINGS, reEnd, reAccountIds, true) // continuity + plug
  put(GIFI_DIVIDENDS_DECLARED, dividendsDeclared, [], false)

  // Computed subtotals/totals.
  put(GIFI_TOTAL_REVENUE, totalRevenue, [], true)
  put(GIFI_TOTAL_EXPENSES, totalExpenses, [], true)
  put(GIFI_NET_BEFORE_TAX, netBeforeTax, [], true)
  put(GIFI_TAX_PROVISION, taxProvision, byCode.get(GIFI_TAX_PROVISION)?.accountIds ?? [], false)
  put(GIFI_NET_INCOME_AFTER_TAX, netIncome9999, [], true)
  put(GIFI_TOTAL_ASSETS, totalAssets, [], true)
  put(GIFI_TOTAL_LIABILITIES, totalLiabilities, [], true)
  put(GIFI_TOTAL_EQUITY, totalEquity, [], true)
  put(GIFI_TOTAL_LIAB_AND_EQUITY, totalLiabAndEquity, [], true)

  // ── NetFile balance gates ──
  // Gate A: 2599 = 3499 + 3620 (after the plug, exact).
  if (roundDollar(totalLiabilities + totalEquity) !== totalAssets) {
    issues.push({
      level: 'error',
      code: 'GIFI_BALANCE_2599',
      message: `Balance sheet does not balance: total assets (2599 = ${totalAssets}) ≠ total liabilities + equity (${roundDollar(
        totalLiabilities + totalEquity,
      )}).`,
      line: `GIFI:${GIFI_TOTAL_ASSETS}`,
    })
  }
  // Gate B: 3640 = 2599.
  if (totalLiabAndEquity !== totalAssets) {
    issues.push({
      level: 'error',
      code: 'GIFI_BALANCE_3640',
      message: `Total liabilities and equity (3640 = ${totalLiabAndEquity}) ≠ total assets (2599 = ${totalAssets}).`,
      line: `GIFI:${GIFI_TOTAL_LIAB_AND_EQUITY}`,
    })
  }
  // Gate C: RE-end reconciliation (the 3680 = 9999 family). The retained-earnings
  // continuity must satisfy RE-end = RE-start + 9999 − dividends declared. Because
  // we DERIVE reEndRaw from exactly that identity, the only residual is the plug;
  // a plug larger than $1 means the two balance-sheet sides disagree by more than
  // whole-dollar rounding noise — a real data error, surfaced as an ERROR.
  if (Math.abs(roundingPlug) > 1) {
    issues.push({
      level: 'error',
      code: 'GIFI_RE_CONTINUITY',
      message: `Retained-earnings continuity is off by ${roundingPlug} (> $1 rounding). RE-end (${reEndRaw}) = RE-start (${roundDollar(
        retainedEarningsOpening,
      )}) + net income (${netIncome9999}) − dividends declared (${roundDollar(
        dividendsDeclared,
      )}) does not reconcile to the equity side of the balance sheet.`,
      line: `GIFI:${GIFI_RETAINED_EARNINGS}`,
    })
  } else if (roundingPlug !== 0) {
    issues.push({
      level: 'warning',
      code: 'GIFI_ROUNDING_PLUG',
      message: `A whole-dollar rounding plug of ${roundingPlug} was posted to retained earnings (3600) to keep 2599 = 3499 + 3620.`,
      line: `GIFI:${GIFI_RETAINED_EARNINGS}`,
    })
  }
  // Blocker 2 warning: a closing entry already posted in the window.
  if (closingEntryPosted) {
    issues.push({
      level: 'warning',
      code: 'GIFI_CLOSING_POSTED',
      message:
        'A year-end closing entry is already posted in this fiscal window; the GIFI income statement was built PRE-CLOSE (closing entries excluded) so net income (9999) and the retained-earnings continuity remain correct.',
    })
  }

  return {
    lines,
    netIncome9999,
    totalAssets2599: totalAssets,
    totalLiabilities3499: totalLiabilities,
    totalEquity3620: totalEquity,
    retainedEarnings3600: reEnd,
    dividendsDeclared3700: roundDollar(dividendsDeclared),
    roundingPlug,
    closingEntryPosted,
    issues,
  }
}

export { GIFI_ROUNDING_PLUG_CODE }
