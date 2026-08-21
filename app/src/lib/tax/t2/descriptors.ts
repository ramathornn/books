/**
 * T2 GIFI-code → Schedule-1 line mapping descriptors (design §1.4).
 *
 * DECLARATIVE ONLY (the dual of `T1_SLIP_MAPS`): each entry says "the GIFI line
 * with this code feeds Schedule-1 line `s1Line`, as an `addition` or a
 * `deduction`". No amounts are hardcoded — the pull (pull.ts) reads each rolled
 * GIFI amount off the income statement and routes it to the right side of
 * Schedule 1, then sums to the 500 (additions) / 510 (deductions) totals and
 * lands net income for tax at line 300:
 *
 *     line 300 = 9999 (book net income, after tax)
 *              + Σ additions (incl. 103 income-tax-provision add-back)
 *              − Σ deductions (CCA, terminal loss, …)
 *
 * The Schedule-8 (CCA) figures — CCA claimed (403), recapture (107), terminal
 * loss (404) — are NOT GIFI-sourced; they come from the CCA engine and are
 * declared in `S1_CCA_ROUTES` so the projection routes them to OPPOSITE sides of
 * Schedule 1 (positive CCA → 403 deduction; recapture → 107 addition; terminal
 * loss → 404 deduction). The meals (8523) 50% restriction lands at 295.
 *
 * Schedule-1 line numbers are flagged [VERIFY] against the current 2025 T2
 * Schedule 1 before any live filing (CRA renumbered some lines).
 *
 * Pure data/contracts only — NO I/O in this file.
 */

import {
  GIFI_DIVIDENDS_DECLARED,
  GIFI_TAX_PROVISION,
} from '@/lib/tax/t2/gifiCodes'

// ---------------------------------------------------------------------------
// Schedule-1 line numbers ([VERIFY] against current 2025 T2 Sch 1)
// ---------------------------------------------------------------------------

/** Schedule-1 line numbers this module references. */
export const S1_LINE = {
  /** book net income carried in from GIFI 9999 (after tax). */
  BOOK_NET_INCOME: '9999',
  /** income-tax provision per books add-back. */
  TAX_PROVISION_ADDBACK: '103',
  /** accounting amortization/depreciation add-back. */
  AMORTIZATION_ADDBACK: '104',
  /** recapture of CCA (addition). */
  RECAPTURE: '107',
  /** non-deductible meals & entertainment, 50% (ITA 67.1). */
  MEALS_50: '295',
  /**
   * non-deductible fines, penalties and interest on tax, 100% (ITA 18(1)(t),
   * 67.5, 67.6). ACCOUNT-sourced (CompanySettings.nonDeductibleExpenseAccountId,
   * default account 6660), not GIFI-sourced — the account keyword-maps to GIFI
   * 8710 alongside deductible interest, so the whole 8710 code cannot be routed.
   * [VERIFY] line number against the current 2025 T2 Schedule 1.
   */
  NON_DEDUCTIBLE: '121',
  /** total additions. */
  TOTAL_ADDITIONS: '500',
  /** CCA from Schedule 8 (deduction). */
  CCA: '403',
  /** terminal loss (deduction). */
  TERMINAL_LOSS: '404',
  /** total deductions. */
  TOTAL_DEDUCTIONS: '510',
  /** net income for tax. */
  NET_INCOME_FOR_TAX: '300',
} as const

// ---------------------------------------------------------------------------
// GIFI-code → Schedule-1 routing (book-to-tax reconciliation, the GIFI side)
// ---------------------------------------------------------------------------

/** Which side of Schedule 1 a reconciling item lands on. */
export type S1Side = 'addition' | 'deduction'

/**
 * One declarative GIFI → Schedule-1 mapping: the rolled GIFI `code` feeds the
 * Schedule-1 line `s1Line` as an `side` (addition/deduction). `requiresConfirm`
 * marks routes whose amount the preparer must confirm before it is applied
 * (amortization add-back and the meals 50% restriction are easy to misroute and
 * load-bearing for the book-to-tax bridge).
 */
export interface GifiToS1Route {
  /** the rolled GIFI code that sources this reconciling item. */
  gifiCode: string
  /** the Schedule-1 line it feeds. */
  s1Line: string
  /** addition (back to income) or deduction (out of income). */
  side: S1Side
  /** human label for the reconciliation worksheet. */
  label: string
  /**
   * For amortization: the GIFI book amortization is added back at 104 and the
   * tax CCA is deducted at 403 (the two are independent — book vs tax). For
   * meals: only the 50% non-deductible portion lands at 295, so this route is a
   * HALF-amount route the pull scales by 0.5.
   */
  halfAmount?: boolean
  /** the preparer must confirm before this route is applied. */
  requiresConfirm?: boolean
}

/**
 * GIFI-sourced Schedule-1 reconciling items (the book-to-tax bridge). For the
 * canonical active-income persona the meaningful entries are the amortization
 * add-back (104) and the income-tax-provision add-back (103); meals (295) fires
 * only when an 8523 balance exists.
 */
export const GIFI_TO_S1_ROUTES: readonly GifiToS1Route[] = [
  {
    gifiCode: GIFI_TAX_PROVISION, // 9990
    s1Line: S1_LINE.TAX_PROVISION_ADDBACK, // 103
    side: 'addition',
    label: 'Income-tax provision per books (add-back)',
  },
  {
    gifiCode: '8670', // amortization of tangible assets
    s1Line: S1_LINE.AMORTIZATION_ADDBACK, // 104
    side: 'addition',
    label: 'Accounting amortization/depreciation (add-back)',
    requiresConfirm: true,
  },
  {
    gifiCode: '8523', // meals and entertainment
    s1Line: S1_LINE.MEALS_50, // 295
    side: 'addition',
    label: 'Non-deductible 50% of meals & entertainment (ITA 67.1)',
    halfAmount: true,
    requiresConfirm: true,
  },
]

// ---------------------------------------------------------------------------
// Schedule-8 (CCA engine) → Schedule-1 routing (NON-GIFI-sourced)
// ---------------------------------------------------------------------------

/** Role of a Schedule-8 total in the Schedule-1 reconciliation. */
export type S8ToS1Role = 'cca' | 'recapture' | 'terminalLoss'

/**
 * One declarative Schedule-8 → Schedule-1 route. The CCA engine produces three
 * totals (CCA claimed, recapture, terminal loss) that land on OPPOSITE sides of
 * Schedule 1. `field` names the `ScheduleEightResult` total the pull reads.
 */
export interface S8ToS1Route {
  role: S8ToS1Role
  /** the `ScheduleEightResult` field that sources the amount. */
  field: 'totalCcaClaimed' | 'totalRecapture' | 'totalTerminalLoss'
  s1Line: string
  side: S1Side
  label: string
}

/** Schedule-8 totals → Schedule-1 routing (opposite-side discipline). */
export const S8_TO_S1_ROUTES: readonly S8ToS1Route[] = [
  {
    role: 'cca',
    field: 'totalCcaClaimed',
    s1Line: S1_LINE.CCA, // 403
    side: 'deduction',
    label: 'Capital cost allowance (Schedule 8)',
  },
  {
    role: 'recapture',
    field: 'totalRecapture',
    s1Line: S1_LINE.RECAPTURE, // 107
    side: 'addition',
    label: 'Recapture of capital cost allowance (Schedule 8)',
  },
  {
    role: 'terminalLoss',
    field: 'totalTerminalLoss',
    s1Line: S1_LINE.TERMINAL_LOSS, // 404
    side: 'deduction',
    label: 'Terminal loss (Schedule 8)',
  },
]

// ---------------------------------------------------------------------------
// Retained-earnings continuity routing (GIFI 3700 dividends declared)
// ---------------------------------------------------------------------------

/**
 * The GIFI code carrying dividends declared in the retained-earnings continuity
 * (RE-end = RE-start + net income − dividends declared). The dividend pull (the
 * single source mirroring computeT5) writes here; declared dividends never feed
 * Schedule 1 (they are an appropriation of after-tax income, not an expense).
 */
export const RE_DIVIDENDS_DECLARED_CODE = GIFI_DIVIDENDS_DECLARED // 3700

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** All GIFI codes that have a Schedule-1 reconciliation route. */
export function gifiCodesWithS1Route(): string[] {
  return GIFI_TO_S1_ROUTES.map((r) => r.gifiCode)
}

/** The Schedule-1 route for a GIFI code, or null if it does not reconcile. */
export function s1RouteForGifi(code: string): GifiToS1Route | null {
  return GIFI_TO_S1_ROUTES.find((r) => r.gifiCode === code) ?? null
}
