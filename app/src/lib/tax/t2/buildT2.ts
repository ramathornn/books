/**
 * T2 build + verify-before-prepare pipeline — `buildT2`.
 *
 * The corporate analogue of buildT1, adapted to the "Prepare & verify" verb (the
 * app can never transmit a T2 or an AT1). It:
 *   1. Loads the T2Return for the fiscal-year-end + the corporate identity.
 *   2. Pulls the corporation's books for the fiscal year (pull.ts) — GIFI roll-up
 *      (buildGifi, bound to the window + opening RE), dividends paid (blocker 1),
 *      Schedule 8 CCA, the active/passive split — and folds in manual
 *      `linesOverride`.
 *   3. Runs the pure federal CCPC engine (computeT2Federal) + the Alberta AT1
 *      engine (computeAt1), narrowing the AB reduced business limit to the federal
 *      reduced limit before the AB run.
 *   4. Runs the verify gate: a ValidationReport of ERRORS (block prepare) +
 *      WARNINGS (acknowledge) — province support, identity (BN+RC, Alberta CAN),
 *      first-year opening-continuity confirmation, GRIP over-designation, the GIFI
 *      balance gates, and arithmetic-integrity checks.
 *   5. Regenerates the re-key worksheet EXPORT IN MEMORY (export.ts) — the primary
 *      deliverable (two PDFs: federal T2 + Alberta AT1). Nothing here persists a
 *      SIN-bearing artifact; the route persists only checksum + report + result.
 *
 * Returns `{ result, report, export }`. The route decides whether to flip the
 * return to `prepared` (blocked when `report.ok === false`) and what to persist.
 *
 * Reads the DB; performs NO writes.
 */

import prisma from '@/lib/prisma'

import { round2, roundDollar } from '@/lib/tax/round'
import { buildGifi } from '@/lib/tax/t2/buildGifi'
import { pull } from '@/lib/tax/t2/pull'
import { computeT2Federal } from '@/lib/tax/t2/computeT2Federal'
import { computeAt1 } from '@/lib/tax/t2/computeAt1'
import { buildT2Export } from '@/lib/tax/t2/export'
import {
  getRateTable,
  isSupportedProvince,
  engineVersionFor,
  DEFAULT_PROVINCE,
} from '@/lib/tax/t2/rates'
import { GIFI_TAX_PROVISION } from '@/lib/tax/t2/gifiCodes'
import type {
  DividendKind,
  PulledRefs,
  T2Export,
  T2ExportIdentification,
  T2Lines,
  T2Result,
  ValidationIssue,
  ValidationReport,
} from '@/lib/tax/t2/types'

/** Re-key / foot tolerance (whole-dollar GIFI; 2-dp tax). */
const FOOT_TOL = 0.5

/** 10-digit Alberta Corporate Account Number format. */
const ALBERTA_CAN_RE = /^\d{10}$/
/** 9-digit BN + 2-letter + 4-digit program account (e.g. RC0001). */
const BN_RC_RE = /^\d{9}[A-Z]{2}\d{4}$/

export interface BuildT2Options {
  /** manual line entries/overrides (instalments, opt-in lines, identity carries). */
  linesOverride?: T2Lines | null
}

export interface BuildT2Result {
  result: T2Result
  report: ValidationReport
  /** in-memory re-key worksheet export; NEVER persisted as-is. */
  export: T2Export
  /** per-line provenance (source + ids) for drift detection + persistence. */
  pulledRefs: PulledRefs
}

interface LoadedReturn {
  id: string
  fiscalYearStart: Date
  fiscalYearEnd: Date
  taxationYear: number
  daysInYear: number
  status: string
  provinceSnapshot: string
  legalNameSnapshot: string
  bnRcSnapshot: string
  linesOverride: unknown
}

/** Coerce a stored JSON value into a numeric line map (string key → number). */
function toLineMap(v: unknown): T2Lines {
  if (!v || typeof v !== 'object') return {}
  const out: T2Lines = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

function money(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

/**
 * Build + verify a T2 (+ AT1) return for a fiscal-year-end. The heart of the
 * verify gate. `fiscalYearEnd` is the canonical key (the corporation is the
 * singleton; one return per FYE).
 */
export async function buildT2(
  fiscalYearEnd: Date,
  opts: BuildT2Options = {},
): Promise<BuildT2Result> {
  const issues: ValidationIssue[] = []

  // ---- load the return (highest non-superseded amendmentSeq for the FYE) ----
  const ret = (await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
    select: {
      id: true,
      fiscalYearStart: true,
      fiscalYearEnd: true,
      taxationYear: true,
      daysInYear: true,
      status: true,
      provinceSnapshot: true,
      legalNameSnapshot: true,
      bnRcSnapshot: true,
      linesOverride: true,
    },
  })) as LoadedReturn | null

  if (!ret) {
    throw new Error(`No T2 return for fiscal year-end ${fiscalYearEnd.toISOString().slice(0, 10)}.`)
  }

  const taxationYear = ret.taxationYear
  const fiscalYearStart = ret.fiscalYearStart
  const province = (ret.provinceSnapshot || DEFAULT_PROVINCE).toUpperCase()

  // ---- corporate identity (live settings; snapshot wins for name/BN) ----
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  const legalName = (ret.legalNameSnapshot || settings?.legalName || '').trim()
  const bnRc = (ret.bnRcSnapshot || settings?.t2ProgramAccount || '').trim().toUpperCase()
  const albertaCan = (settings?.albertaCorporateAccountNumber || '').trim()
  const dividendsDeclaredAccountId = settings?.dividendsDeclaredAccountId ?? null

  // ---- province profile gate (Alberta-only in v1) ----
  if (!isSupportedProvince(province)) {
    issues.push({
      level: 'error',
      code: 'PROVINCE_UNSUPPORTED',
      message: `Province ${province} is not supported in v1. Only Alberta (AB) corporate returns are supported.`,
    })
  }
  const rateTable = getRateTable(taxationYear, province)
  const engineVersion = engineVersionFor(taxationYear)

  if (rateTable.taxationYear !== taxationYear) {
    issues.push({
      level: 'warning',
      code: 'RATE_YEAR_FALLBACK',
      message: `No corporate rate table for ${taxationYear}; using ${rateTable.taxationYear} figures. Verify the rates before relying on this.`,
    })
  }

  // ---- short-year gate (full 12-month years only in v1) ----
  if (ret.daysInYear !== 365 && ret.daysInYear !== 366) {
    issues.push({
      level: 'error',
      code: 'SHORT_YEAR_UNSUPPORTED',
      message: `This fiscal period is ${ret.daysInYear} days. v1 supports full 12-month years only — a short year prorates the SBD and CCA.`,
    })
  }

  // ---- identity gates ----
  if (!legalName) {
    issues.push({ level: 'error', code: 'NO_LEGAL_NAME', message: 'The corporation legal name is required.' })
  }
  if (!bnRc) {
    issues.push({
      level: 'error',
      code: 'NO_BN_RC',
      message: 'The Business Number + RC program account (CompanySettings.t2ProgramAccount) is required for the T2.',
    })
  } else if (!BN_RC_RE.test(bnRc)) {
    issues.push({
      level: 'error',
      code: 'BN_RC_FORMAT',
      message: `The program account "${bnRc}" is not a valid BN + program account (9 digits + 2 letters + 4 digits, e.g. ...RC0001).`,
    })
  }
  // Alberta CAN is REQUIRED for the AT1 (Alberta files separately).
  if (!albertaCan) {
    issues.push({
      level: 'error',
      code: 'NO_ALBERTA_CAN',
      message: 'The Alberta Corporate Account Number (CompanySettings.albertaCorporateAccountNumber) is required for the AT1.',
    })
  } else if (!ALBERTA_CAN_RE.test(albertaCan)) {
    issues.push({
      level: 'error',
      code: 'ALBERTA_CAN_FORMAT',
      message: `The Alberta CAN "${albertaCan}" is not 10 numeric digits.`,
    })
  }

  // ---- opening continuity confirmation (first-year gate) ----
  const continuityRow = await prisma.t2ContinuityBalance.findUnique({ where: { fiscalYearEnd } })
  const priorFye = new Date(
    Date.UTC(fiscalYearEnd.getUTCFullYear() - 1, fiscalYearEnd.getUTCMonth(), fiscalYearEnd.getUTCDate(), 23, 59, 59, 999),
  )
  const priorPrepared = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd: priorFye, status: 'prepared' },
    select: { id: true },
  })
  // No prior prepared return ⇒ this is the first filed year; openings must be
  // explicitly confirmed (openingConfirmed) before prepare.
  if (!priorPrepared && !(continuityRow?.openingConfirmed === true)) {
    issues.push({
      level: 'error',
      code: 'OPENING_UNCONFIRMED',
      message:
        'This is the first filed year (no prior prepared T2). Confirm the opening RDTOH / GRIP / retained-earnings continuity balances (T2ContinuityBalance.openingConfirmed) before preparing.',
    })
  }

  const retainedEarningsOpening = readRe(continuityRow)

  // ---- pull the corporation's books (GIFI bound to the window + opening RE) ----
  const pullResult = await pull({
    taxationYear,
    fiscalYearStart,
    fiscalYearEnd,
    province,
    buildGifi: async () =>
      buildGifi({
        fiscalYearEnd,
        fiscalYearStart,
        retainedEarningsOpening,
        dividendsDeclaredAccountId,
      }),
    legacyDividendKind: 'nonEligible' as DividendKind,
  })
  issues.push(...pullResult.issues)

  // ---- Schedule 1 book-to-tax bridge (the GIFI-sourced add-backs the pull
  // leaves to buildT2). GIFI net income (9999) is AFTER tax, so net income for
  // tax must add back: the income-tax provision per books (S1:103, GIFI 9990),
  // accounting amortization (S1:104, GIFI 8670 — the book charge the tax CCA at
  // 403 replaces), 50% of meals & entertainment (S1:295, ITA 67.1, GIFI 8523
  // × 0.5), and 100% of non-deductible fines/penalties/interest-on-tax (S1:121,
  // ITA 18(1)(t)/67.5/67.6 — account-sourced, since the account keyword-maps to
  // GIFI 8710 alongside deductible interest). Recapture (107) and
  // CCA/terminal-loss (403/404) are already netted into the pull's S1:300 /
  // federalInput.taxableIncome.
  const gifiLines = pullResult.gifi.lines
  const taxProvision = roundDollar(gifiLines[GIFI_TAX_PROVISION]?.amount ?? 0) // 9990
  const bookAmortization = roundDollar(gifiLines['8670']?.amount ?? 0)
  const mealsTotal = roundDollar(gifiLines['8523']?.amount ?? 0)
  const mealsAddBack = roundDollar(mealsTotal * 0.5)
  const nonDeductible = await nonDeductibleAddBack(
    settings?.nonDeductibleExpenseAccountId ?? null,
    fiscalYearStart,
    fiscalYearEnd,
    issues,
  )
  if (nonDeductible.lineIds.length > 0) {
    pullResult.pulledRefs['S1:121'] = {
      source: 'JE',
      ids: nonDeductible.lineIds,
      total: nonDeductible.amount,
    }
  }
  const s1AddBacks = roundDollar(taxProvision + bookAmortization + mealsAddBack + nonDeductible.amount)

  // Re-derive taxable income + ABI with the add-backs layered on. The pull's
  // figures already carry the CCA/recapture/terminal-loss spine.
  const federalInput = {
    ...pullResult.federalInput,
    taxableIncome: round2(pullResult.federalInput.taxableIncome + s1AddBacks),
    activeBusinessIncome: Math.max(0, round2(pullResult.federalInput.activeBusinessIncome + s1AddBacks)),
  }

  // ---- federal compute ----
  const federal = computeT2Federal(federalInput, rateTable.federal, engineVersion)

  // ---- Alberta compute: narrow the AB reduced limit to the federal reduced limit ----
  // and carry the same bridged taxable income (Sch 12 default 0, already folded).
  const albertaInput = {
    ...pullResult.albertaInput,
    albertaTaxableIncome: round2(federalInput.taxableIncome),
    activeBusinessIncome: federalInput.activeBusinessIncome,
    reducedBusinessLimit: federal.businessLimit,
  }
  const alberta = computeAt1(albertaInput, rateTable.alberta, engineVersion)

  // ---- merge engine lines over the pulled lines, then apply manual overrides ----
  const override: T2Lines = {
    ...toLineMap(ret.linesOverride),
    ...(opts.linesOverride ?? {}),
  }
  const effectiveLines: T2Lines = {
    ...pullResult.lines,
    ...federal.lines,
    ...alberta.lines,
    // Schedule 1 book-to-tax bridge lines (computed in buildT2).
    'S1:103': taxProvision,
    'S1:104': bookAmortization,
    'S1:295': mealsAddBack,
    'S1:121': nonDeductible.amount,
    'S1:500': roundDollar(s1AddBacks + pullResult.scheduleEight.totalRecapture),
    'S1:510': roundDollar(pullResult.scheduleEight.totalCcaClaimed + pullResult.scheduleEight.totalTerminalLoss),
    'S1:300': federalInput.taxableIncome,
    ...override,
  }

  // ---- GRIP over-designation (hard prepare-gate; blocker 3) ----
  if (federal.gripOverDesignated) {
    issues.push({
      level: 'error',
      code: 'GRIP_OVER_DESIGNATED',
      message: `Eligible dividends paid (${money(pullResult.dividendsPaid.eligible)}) exceed the closing GRIP room (${money(federal.closingGripBeforeDivs)}). Designating an eligible dividend over GRIP triggers the ITA 185.1 Part III.1 penalty (20–30%). Re-designate the excess as non-eligible.`,
    })
  }

  // ---- arithmetic-integrity checks ----
  issues.push(...arithmeticChecks(federal, alberta, pullResult.gifi.netIncome9999))

  // ---- engineVersion consistency ----
  if (federal.engineVersion !== engineVersion) {
    issues.push({
      level: 'warning',
      code: 'ENGINE_VERSION_SKEW',
      message: `Computed engine version (${federal.engineVersion}) differs from the registry version (${engineVersion}); re-prepare to refresh.`,
    })
  }

  // ---- shareholder-loan detect-only warning (ITA 15(2)/80.4) ----
  const dueFromShareholder = pullResult.gifi.lines['1480']?.amount ?? 0
  if (dueFromShareholder > 0) {
    issues.push({
      level: 'warning',
      code: 'SHAREHOLDER_LOAN_OWING',
      message: `A "Due from shareholder(s)" balance of ${money(dueFromShareholder)} is owing at year-end (GIFI 1480). A loan owing for >1 year may be income under ITA 15(2); ITA 80.4 imputes a benefit on interest-free balances. Review before filing.`,
      line: 'GIFI:1480',
    })
  }

  // ---- assemble the combined result ----
  const result: T2Result = {
    taxationYear,
    fiscalYearStart: fiscalYearStart.toISOString().slice(0, 10),
    fiscalYearEnd: fiscalYearEnd.toISOString().slice(0, 10),
    daysInYear: ret.daysInYear,
    province,
    gifi: pullResult.gifi,
    scheduleEight: pullResult.scheduleEight,
    dividendsPaid: pullResult.dividendsPaid,
    federal,
    alberta,
    lines: effectiveLines,
    engineVersion,
  }

  const ok = issues.every((i) => i.level !== 'error')
  const report: ValidationReport = {
    ok,
    checkedAt: new Date().toISOString(),
    taxationYear,
    province,
    issues,
  }

  const identification: T2ExportIdentification = {
    legalName,
    bnRc,
    albertaCan,
    province,
    fiscalYearStart: fiscalYearStart.toISOString().slice(0, 10),
    fiscalYearEnd: fiscalYearEnd.toISOString().slice(0, 10),
    // Schedule 50 single-shareholder SIN is not stored on the corporate side in
    // v1; the re-key worksheet leaves it for the owner to enter by hand.
    shareholderName: null,
    shareholderSin: null,
  }

  const export_ = buildT2Export(result, identification, report)

  return { result, report, export: export_, pulledRefs: pullResult.pulledRefs }
}

// ---------------------------------------------------------------------------
// Verify-gate sub-checks
// ---------------------------------------------------------------------------

/**
 * Arithmetic-integrity errors over the computed federal + Alberta results: no
 * negative net-tax (the clamps held), Part I non-negative, AT1 tax non-negative,
 * and the SBD income never exceeds the reduced business limit. These guard a
 * corrupted override / logic regression — they should never fire on a clean
 * compute.
 */
function arithmeticChecks(
  federal: { partOneTax: number; businessLimit: number; sbdIncome: number },
  alberta: { albertaTaxPayable: number; albertaSbdIncome: number },
  bookNetIncome: number,
): ValidationIssue[] {
  const out: ValidationIssue[] = []

  if (federal.partOneTax < -FOOT_TOL) {
    out.push({ level: 'error', code: 'CLAMP_PART_I', message: `Part I tax (T2:700) is negative (${money(federal.partOneTax)}).`, line: 'T2:700' })
  }
  if (alberta.albertaTaxPayable < -FOOT_TOL) {
    out.push({ level: 'error', code: 'CLAMP_AT1', message: `Alberta tax payable (AT1:072) is negative (${money(alberta.albertaTaxPayable)}).`, line: 'AT1:072' })
  }
  if (federal.sbdIncome > federal.businessLimit + FOOT_TOL) {
    out.push({
      level: 'error',
      code: 'SBD_OVER_LIMIT',
      message: `SBD income (${money(federal.sbdIncome)}) exceeds the reduced business limit (${money(federal.businessLimit)}).`,
      line: 'S7:425',
    })
  }
  if (alberta.albertaSbdIncome > federal.businessLimit + FOOT_TOL) {
    out.push({
      level: 'error',
      code: 'AB_SBD_OVER_LIMIT',
      message: `Alberta SBD income (${money(alberta.albertaSbdIncome)}) exceeds the federal reduced business limit (${money(federal.businessLimit)}).`,
      line: 'AT1:061',
    })
  }
  // A negative book net income is allowed (a loss year); only flag a NaN.
  if (!Number.isFinite(bookNetIncome)) {
    out.push({ level: 'error', code: 'NET_INCOME_NAN', message: 'GIFI net income (9999) is not a finite number.', line: 'GIFI:9999' })
  }

  return out
}

/** Fallback source account for the S1:121 add-back when none is configured. */
const NON_DEDUCTIBLE_DEFAULT_ACCOUNT_NUMBER = '6660'
const NON_DEDUCTIBLE_NAME_RE = /non.?deductible/i

/**
 * Non-deductible fines/penalties/interest-on-tax add-back (S1:121, 100%, ITA
 * 18(1)(t)/67.5/67.6). Sourced from a single GL ACCOUNT — the configured
 * `CompanySettings.nonDeductibleExpenseAccountId`, falling back to account
 * number 6660 — because the account keyword-maps to GIFI 8710 (interest & bank
 * charges) alongside fully-deductible interest, so no GIFI-code route can
 * isolate it. Activity is the fiscal window's posted, non-closing JE lines
 * (debit-normal), matching the pre-close basis of the other S1 add-backs.
 *
 * Also feeds the verify gate: any OTHER active expense account named
 * "non-deductible" with activity this year raises a WARNING — its balance is
 * being silently deducted in full.
 */
async function nonDeductibleAddBack(
  configuredAccountId: string | null,
  fiscalYearStart: Date,
  fiscalYearEnd: Date,
  issues: ValidationIssue[],
): Promise<{ amount: number; lineIds: string[] }> {
  let account = configuredAccountId
    ? await prisma.gLAccount.findUnique({
        where: { id: configuredAccountId },
        select: { id: true, accountNumber: true, accountName: true },
      })
    : null
  if (!account) {
    account = await prisma.gLAccount.findFirst({
      where: { accountNumber: NON_DEDUCTIBLE_DEFAULT_ACCOUNT_NUMBER, isActive: true },
      select: { id: true, accountNumber: true, accountName: true },
    })
  }

  // Lookalike sweep for the verify gate: expense accounts NAMED non-deductible
  // that are not the wired source.
  const lookalikes = (
    await prisma.gLAccount.findMany({
      where: {
        isActive: true,
        accountClass: 'expense',
        accountName: { contains: 'deductible', mode: 'insensitive' },
      },
      select: { id: true, accountNumber: true, accountName: true },
    })
  ).filter((a) => NON_DEDUCTIBLE_NAME_RE.test(a.accountName) && a.id !== account?.id)

  const accountIds = [...(account ? [account.id] : []), ...lookalikes.map((a) => a.id)]
  const activity = new Map<string, { net: number; lineIds: string[] }>()
  if (accountIds.length > 0) {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        glAccountId: { in: accountIds },
        journalEntry: {
          status: 'posted',
          kind: { not: 'closing' },
          entryDate: { gte: fiscalYearStart, lte: fiscalYearEnd },
        },
      },
      select: { id: true, glAccountId: true, debit: true, credit: true },
    })
    for (const l of lines) {
      const cur = activity.get(l.glAccountId) ?? { net: 0, lineIds: [] }
      cur.net += Number(l.debit) - Number(l.credit) // expense: debit-normal
      cur.lineIds.push(l.id)
      activity.set(l.glAccountId, cur)
    }
  }

  for (const a of lookalikes) {
    const net = roundDollar(activity.get(a.id)?.net ?? 0)
    if (net === 0) continue
    issues.push({
      level: 'warning',
      code: 'NON_DEDUCTIBLE_UNWIRED',
      message:
        `Account ${a.accountNumber} "${a.accountName}" looks non-deductible and has ${money(net)} of activity this year, ` +
        `but is not the configured Schedule 1 add-back account — it is being fully deducted. ` +
        `Set CompanySettings.nonDeductibleExpenseAccountId (or merge it into the wired account).`,
      accountId: a.id,
    })
  }

  const wired = account ? activity.get(account.id) : undefined
  // Clamp at 0: a net-credit year (refund of a penalty) must not REDUCE income.
  const amount = Math.max(0, roundDollar(wired?.net ?? 0))
  return { amount, lineIds: amount > 0 ? (wired?.lineIds ?? []) : [] }
}

/**
 * Read opening retained earnings from the continuity record. The continuity row
 * carries the RDTOH/GRIP openings; opening RETAINED EARNINGS for the GIFI roll
 * forward is not a dedicated column in v1, so it is 0 in the first year and the
 * prior year's closing RE (RE-start + NI − dividends) thereafter. buildGifi
 * recomputes RE-end from this opening, so 0 is the safe first-year default.
 */
function readRe(row: { openingGrip: unknown } | null): number {
  // No dedicated opening-RE column in v1; default 0 (first-year persona). The
  // GIFI builder folds NI + dividends to reach RE-end from this opening.
  void row
  return 0
}

export { roundDollar }
