/**
 * GENERIC GIFI (General Index of Financial Information) code library + a keyword
 * suggested-default map for the bulk mapper.
 *
 * GIFI codes are the public 4-digit identifiers the CRA uses to roll a trial
 * balance into a T2 (Schedule 100 balance sheet / Schedule 125 income statement).
 * These are public law — NOT personal data. Nothing here is a real account.
 *
 * RECONCILIATION (gap-fix blocker 5): the seed (scripts/ensure-gifi-codes.ts)
 * tags retained earnings as 3600. buildGifi COMPUTES every subtotal/total in
 * engine (2599, 3499, 3620, 9999, …) rather than relying on seeded subtotal
 * codes, and points the continuity balances + the whole-dollar rounding PLUG at
 * GIFI 3600. RETAINED_EARNINGS below is therefore 3600 to match the seed.
 *
 * Pure data; no I/O.
 */

import type { GifiSchedule } from '@/lib/tax/t2/types'

/** A GIFI code definition: code, schedule, label, and whether it's a subtotal. */
export interface GifiCodeDef {
  code: string
  schedule: GifiSchedule
  label: string
  /** true for engine-computed subtotals/totals (never pulled from one account). */
  subtotal: boolean
}

// ── Retained-earnings + continuity anchor (matches the seed; blocker 5) ──────
/** Retained earnings / deficit (end) — continuity + rounding-plug home. */
export const GIFI_RETAINED_EARNINGS = '3600'
/** Total assets (S100 subtotal). */
export const GIFI_TOTAL_ASSETS = '2599'
/** Total liabilities (S100 subtotal). */
export const GIFI_TOTAL_LIABILITIES = '3499'
/** Total shareholder equity (S100 subtotal). */
export const GIFI_TOTAL_EQUITY = '3620'
/** Total liabilities + equity (S100 subtotal — must equal 2599). */
export const GIFI_TOTAL_LIAB_AND_EQUITY = '3640'
/** Dividends declared in the fiscal year (RE statement). */
export const GIFI_DIVIDENDS_DECLARED = '3700'
/** Net income/loss after taxes (S125 — the carry into Schedule 1). */
export const GIFI_NET_INCOME_AFTER_TAX = '9999'
/** Total revenue (S125 subtotal). */
export const GIFI_TOTAL_REVENUE = '8299'
/** Total expenses / total operating expenses (S125 subtotal). */
export const GIFI_TOTAL_EXPENSES = '9368'
/** Net income/loss before taxes (S125 subtotal). */
export const GIFI_NET_BEFORE_TAX = '9970'
/** Total income tax provision per books (feeds Schedule 1 line 103 add-back). */
export const GIFI_TAX_PROVISION = '9990'

/**
 * The whole-dollar rounding PLUG goes here (retained earnings) so the accounting
 * identity 2599 = 3499 + 3620 survives independent whole-dollar rounding of the
 * two sides of the balance sheet. (Blocker 5.)
 */
export const GIFI_ROUNDING_PLUG_CODE = GIFI_RETAINED_EARNINGS

/**
 * GENERIC GIFI library — a small, public set of the codes the v1 persona's roll-
 * up touches. Detail codes that vary account-by-account are intentionally
 * limited; the keyword map below suggests them, the accountant confirms.
 *
 * Subtotal/total codes are marked `subtotal:true` — buildGifi computes them and
 * never pulls them from a single account.
 */
export const GIFI_LIBRARY: Record<string, GifiCodeDef> = {
  // ── Schedule 100 — balance sheet ──
  '1001': { code: '1001', schedule: 'S100', label: 'Cash and deposits', subtotal: false },
  '1060': { code: '1060', schedule: 'S100', label: 'Trade accounts receivable', subtotal: false },
  '1480': { code: '1480', schedule: 'S100', label: 'Due from shareholder(s)/director(s)', subtotal: false },
  '1740': { code: '1740', schedule: 'S100', label: 'Property, plant and equipment (net)', subtotal: false },
  '2599': { code: '2599', schedule: 'S100', label: 'Total assets', subtotal: true },
  '2620': { code: '2620', schedule: 'S100', label: 'Trade payables and accrued liabilities', subtotal: false },
  '2680': { code: '2680', schedule: 'S100', label: 'Taxes payable', subtotal: false },
  '2962': { code: '2962', schedule: 'S100', label: 'Due to shareholder(s)/director(s)', subtotal: false },
  '3499': { code: '3499', schedule: 'S100', label: 'Total liabilities', subtotal: true },
  '3500': { code: '3500', schedule: 'S100', label: 'Common shares', subtotal: false },
  '3600': { code: '3600', schedule: 'S100', label: 'Retained earnings/deficit (end)', subtotal: false },
  '3620': { code: '3620', schedule: 'S100', label: 'Total shareholder equity', subtotal: true },
  '3640': { code: '3640', schedule: 'S100', label: 'Total liabilities and shareholder equity', subtotal: true },
  '3700': { code: '3700', schedule: 'S100', label: 'Dividends declared', subtotal: false },

  // ── Schedule 125 — income statement ──
  '8000': { code: '8000', schedule: 'S125', label: 'Trade sales of goods and services', subtotal: false },
  '8090': { code: '8090', schedule: 'S125', label: 'Interest income', subtotal: false },
  '8210': { code: '8210', schedule: 'S125', label: 'Realized gains/other revenue', subtotal: false },
  '8299': { code: '8299', schedule: 'S125', label: 'Total revenue', subtotal: true },
  '8320': { code: '8320', schedule: 'S125', label: 'Purchases/cost of materials', subtotal: false },
  '8521': { code: '8521', schedule: 'S125', label: 'Advertising and promotion', subtotal: false },
  '8523': { code: '8523', schedule: 'S125', label: 'Meals and entertainment', subtotal: false },
  '8670': { code: '8670', schedule: 'S125', label: 'Amortization of tangible assets', subtotal: false },
  '8690': { code: '8690', schedule: 'S125', label: 'Insurance', subtotal: false },
  '8710': { code: '8710', schedule: 'S125', label: 'Interest and bank charges', subtotal: false },
  '8810': { code: '8810', schedule: 'S125', label: 'Office expenses', subtotal: false },
  '8860': { code: '8860', schedule: 'S125', label: 'Professional fees', subtotal: false },
  '8910': { code: '8910', schedule: 'S125', label: 'Rental', subtotal: false },
  '9060': { code: '9060', schedule: 'S125', label: 'Salaries and wages', subtotal: false },
  '9200': { code: '9200', schedule: 'S125', label: 'Travel expenses', subtotal: false },
  '9281': { code: '9281', schedule: 'S125', label: 'Vehicle expenses', subtotal: false },
  '9368': { code: '9368', schedule: 'S125', label: 'Total operating expenses', subtotal: true },
  '9970': { code: '9970', schedule: 'S125', label: 'Net income/loss before taxes', subtotal: true },
  '9990': { code: '9990', schedule: 'S125', label: 'Income tax provision (per books)', subtotal: false },
  '9999': { code: '9999', schedule: 'S125', label: 'Net income/loss after taxes', subtotal: true },
}

/**
 * GENERIC keyword → suggested GIFI code map for the bulk mapper. Matched against
 * a lower-cased account name (and detailType). First match wins; the accountant
 * confirms. Amortization (8670) and meals (8523) REQUIRE explicit confirmation
 * (see `REQUIRES_CONFIRM`). No real account data — generic keywords only.
 */
export const GIFI_KEYWORD_DEFAULTS: ReadonlyArray<{ keyword: RegExp; code: string }> = [
  // Assets / liabilities / equity
  { keyword: /\b(cash|chequing|checking|savings|bank|deposit)\b/, code: '1001' },
  { keyword: /accounts? receivable|trade receivable|\ba\/r\b/, code: '1060' },
  { keyword: /due from shareholder|shareholder loan receivable/, code: '1480' },
  { keyword: /property,? plant|equipment|fixed asset/, code: '1740' },
  { keyword: /accounts? payable|trade payable|\ba\/p\b|accrued/, code: '2620' },
  { keyword: /\b(gst|hst)\b.*(payable|owing|collected)|taxes? payable/, code: '2680' },
  { keyword: /due to shareholder|shareholder loan payable/, code: '2962' },
  { keyword: /common shares?|share capital|capital stock/, code: '3500' },
  { keyword: /retained earnings|deficit/, code: '3600' },
  { keyword: /dividends? declared/, code: '3700' },
  // Revenue
  { keyword: /\b(sales|revenue|service income|fees? income|professional fees? income)\b/, code: '8000' },
  { keyword: /interest income/, code: '8090' },
  { keyword: /other income|miscellaneous income|gain/, code: '8210' },
  // Expenses (the high-value generic defaults from the gap review)
  { keyword: /cost of (goods|sales|materials)|purchases|\bcogs\b/, code: '8320' },
  { keyword: /advertis|promotion|marketing/, code: '8521' },
  { keyword: /meals?|entertainment/, code: '8523' },
  { keyword: /amortization|depreciation/, code: '8670' },
  { keyword: /insurance/, code: '8690' },
  { keyword: /interest|bank charge|bank fee/, code: '8710' },
  { keyword: /office|supplies|software|subscription/, code: '8810' },
  { keyword: /professional fees?|legal|accounting|consult/, code: '8860' },
  { keyword: /rent\b|rental|lease/, code: '8910' },
  { keyword: /salar|wages|payroll/, code: '9060' },
  { keyword: /travel/, code: '9200' },
  { keyword: /vehicle|auto|mileage|fuel/, code: '9281' },
  { keyword: /income tax (expense|provision)|corporate tax expense/, code: '9990' },
]

/**
 * GIFI codes whose suggested default REQUIRES explicit user confirmation before
 * it is applied (amortization 8670 feeds the Schedule 1 line 104 add-back; meals
 * 8523 feeds the line 295 50% restriction — both are load-bearing and easy to
 * misroute). Mirrors the gap-review "mandatory-confirm" list.
 */
export const GIFI_REQUIRES_CONFIRM: ReadonlySet<string> = new Set(['8670', '8523'])

/**
 * Suggest a GIFI code for an account from its name/detailType. Returns the code
 * and whether it requires explicit confirmation, or null when nothing matches
 * (the accountant maps it by hand). Pure.
 */
export function suggestGifiCode(input: {
  accountName: string
  detailType?: string
}): { code: string; requiresConfirm: boolean } | null {
  const haystack = `${input.accountName} ${input.detailType ?? ''}`.toLowerCase()
  for (const { keyword, code } of GIFI_KEYWORD_DEFAULTS) {
    if (keyword.test(haystack)) {
      return { code, requiresConfirm: GIFI_REQUIRES_CONFIRM.has(code) }
    }
  }
  return null
}

/** Look up a GIFI definition by code, or null if not in the generic library. */
export function gifiDef(code: string): GifiCodeDef | null {
  return GIFI_LIBRARY[code] ?? null
}
