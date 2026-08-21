/**
 * T2 pull (DB adapter) — assembles the federal + Alberta engine inputs from the
 * company's GL, CCA schedule, dividend declarations, and the continuity record.
 *
 * The dual of the T1 slip pull. Where T1 reads a filer's slips, the T2 pull reads
 * the CORPORATION's books for one fiscal year:
 *   - GIFI income statement / balance sheet via `buildGifi` (injected; built by
 *     the GIFI builder so this adapter never re-implements the roll-up or the
 *     balance gates). buildGifi already excludes kind='closing' entries and
 *     computes net income PRE-CLOSE (blocker 2).
 *   - DIVIDENDS PAID via BLOCKER 1: the SAME sourcing as computeT5 — POSTED
 *     journal-entry DEBITS to CompanySettings.dividendsDeclaredAccountId, grouped
 *     by JournalEntry.dividendEligibility (null → falls back to the
 *     `legacyKind` argument). ERROR when the account is unset; ERROR when more
 *     than one recipient is detected (v1 is single-shareholder). This single
 *     source feeds Schedule 3 Part 2 (dividends paid), retained-earnings GIFI
 *     3700, the dividend refund, and the GRIP gate.
 *   - CCA via the Schedule 8 projection (`scheduleEight`): Σ ccaClaimed (S1 403),
 *     recapture (S1 107), terminal loss (S1 404).
 *   - the ACTIVE / passive income split from GLAccount.incomeNature on the
 *     accounts feeding the GIFI income statement — drives ABI vs AII (and so the
 *     whole CCPC machinery). For the v1 persona everything is 'active', so AII=0
 *     and ART/RDTOH/Part IV/dividend-refund all degrade to 0.
 *   - opening continuity (ERDTOH/NERDTOH/GRIP, prior-year AAII) from the
 *     T2ContinuityBalance row for the FYE; prior-year AAII also falls back to the
 *     prior T2Return.resultSnapshot when no continuity row exists (0 first year).
 *
 * Every pulled line records a `PulledRef` (source + underlying ids + total) so a
 * later recompute can detect drift. Reads the DB; performs NO writes.
 */

import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'
import { scheduleEight } from '@/lib/tax/t2/scheduleEight'
import { gifiDef } from '@/lib/tax/t2/gifiCodes'
import type {
  DividendKind,
  DividendsPaid,
  GifiResult,
  PulledRef,
  PulledRefs,
  PullResult,
  T2FederalInput,
  At1Input,
  T2Lines,
  ValidationIssue,
} from '@/lib/tax/t2/types'

/**
 * The injected GIFI builder. `buildGifi` lives in its own module (built in
 * parallel); the pull takes it as a dependency so this adapter stays decoupled
 * from the roll-up internals and remains independently type-checkable. The
 * orchestrator (buildT2) passes the real implementation bound to the fiscal
 * window + opening retained earnings + opening balances.
 */
export type BuildGifiFn = () => Promise<GifiResult>

export interface T2PullOptions {
  taxationYear: number
  /** ISO fiscal-year boundaries (the GL window the dividend pull is scoped to). */
  fiscalYearStart: Date
  fiscalYearEnd: Date
  /** the corporation's province (snapshot); only 'AB' is supported in v1. */
  province: string
  /** the GIFI builder, pre-bound to this fiscal window (see BuildGifiFn). */
  buildGifi: BuildGifiFn
  /** PSB flag — confirmed on the return; defaults false for the v1 persona. */
  isPersonalServicesBusiness?: boolean
  /** taxable capital employed in Canada (drives the $10M–$50M grind; ~0 here). */
  taxableCapital?: number
  /** Alberta income allocation factor (1.0 for a single Alberta PE). */
  allocationFactor?: number
  /** Innovation Employment Grant credit (AT1 line 129); default 0. */
  innovationEmploymentGrant?: number
  /** Schedule 12 federal→Alberta income adjustment; default 0. */
  scheduleTwelveAdjustment?: number
  /**
   * Fallback eligibility for LEGACY dividend declarations whose JE predates the
   * `dividendEligibility` tag. Defaults to 'nonEligible' (blocker 3: GRIP is $0
   * for this persona, so an untagged declaration is non-eligible).
   */
  legacyDividendKind?: DividendKind
}

/** Coerce a Prisma Decimal | string | number | null to a finite number. */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === 'object' ? Number(v.toString()) : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Extract the free-text recipient label from a dividend JE/line description of
 * the form "Dividend declared — <label>" (the format declareDividend writes).
 * Returns the trimmed label, or null when the description does not match (so
 * non-dividend or legacy entries never contribute a phantom recipient).
 */
function recipientLabel(description: string | null | undefined): string | null {
  if (!description) return null
  const m = /dividend declared\s*[—-]\s*(.+)$/i.exec(description.trim())
  const label = m?.[1]?.trim()
  return label ? label : null
}

/**
 * Pull DIVIDENDS PAID in the fiscal window (BLOCKER 1): posted JE debits to the
 * dividends-declared account, grouped by `dividendEligibility` (null → legacy
 * fallback). Mirrors computeT5's sourcing exactly. Emits:
 *   - ERROR DIVIDEND_ACCT_UNSET when the account is not configured,
 *   - ERROR DIVIDEND_MULTI_RECIPIENT when >1 distinct recipient party is seen
 *     (v1 is single-shareholder).
 */
async function pullDividendsPaid(
  fiscalYearStart: Date,
  fiscalYearEnd: Date,
  legacyKind: DividendKind,
): Promise<{ dividends: DividendsPaid; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = []
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  const accountId = settings?.dividendsDeclaredAccountId ?? null

  if (!accountId) {
    issues.push({
      level: 'error',
      code: 'DIVIDEND_ACCT_UNSET',
      message:
        'The dividends-declared GL account is not configured (CompanySettings.dividendsDeclaredAccountId). Set it before preparing the T2 — it is the single source for dividends paid, GIFI 3700, the dividend refund, and GRIP.',
    })
    return {
      dividends: {
        eligible: 0,
        nonEligible: 0,
        total: 0,
        dividendsDeclaredAccountId: null,
        journalEntryLineIds: [],
      },
      issues,
    }
  }

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: accountId,
      journalEntry: { status: 'posted', entryDate: { gte: fiscalYearStart, lte: fiscalYearEnd } },
    },
    select: {
      id: true,
      debit: true,
      description: true,
      journalEntry: { select: { dividendEligibility: true, description: true } },
    },
  })

  let eligible = 0
  let nonEligible = 0
  const journalEntryLineIds: string[] = []
  // The recipient is not a structured FK on the JE/line (mirrors computeT5: the
  // whole declared-account total IS the single shareholder's dividend). The only
  // recipient signal declareDividend records is the free-text label in the
  // "Dividend declared — <label>" description; parse distinct labels to gate the
  // single-shareholder invariant. Untagged/legacy entries simply contribute no
  // label and never trip the gate.
  const recipients = new Set<string>()

  for (const l of lines) {
    const amt = toNum(l.debit)
    if (amt === 0) continue
    const tag = (l.journalEntry.dividendEligibility as DividendKind | null) ?? legacyKind
    if (tag === 'eligible') eligible = round2(eligible + amt)
    else nonEligible = round2(nonEligible + amt)
    journalEntryLineIds.push(l.id)
    const label = recipientLabel(l.description) ?? recipientLabel(l.journalEntry.description)
    if (label) recipients.add(label)
  }

  if (recipients.size > 1) {
    issues.push({
      level: 'error',
      code: 'DIVIDEND_MULTI_RECIPIENT',
      message: `Dividends were declared to ${recipients.size} distinct recipients (${[...recipients].join(', ')}) in the fiscal year; v1 supports a single shareholder only.`,
    })
  }

  return {
    dividends: {
      eligible: round2(eligible),
      nonEligible: round2(nonEligible),
      total: round2(eligible + nonEligible),
      dividendsDeclaredAccountId: accountId,
      journalEntryLineIds,
    },
    issues,
  }
}

/**
 * Split the GIFI income statement into ACTIVE business income vs aggregate
 * INVESTMENT income (+ taxable capital gains) using GLAccount.incomeNature on the
 * accounts that fed each S125 revenue/expense line.
 *
 * Net income (9999) is apportioned: revenue/expense accounts tagged 'investment'
 * or 'capitalGains' are pulled OUT of active income into AII; everything else
 * (the default 'active'/null) stays in ABI. For the v1 persona every operating
 * account is active, so AII = 0 and ABI = net income.
 *
 * Returns the active/AII/capital-gains split plus the contributing account ids
 * (provenance) and any UNCLASSIFIED-passive warning.
 */
async function splitIncomeNature(
  gifi: GifiResult,
): Promise<{
  activeBusinessIncome: number
  aggregateInvestmentIncome: number
  investmentAccountIds: string[]
  issues: ValidationIssue[]
}> {
  const issues: ValidationIssue[] = []
  const netIncome = round2(gifi.netIncome9999)

  // Gather every S125 (income-statement) account id that fed the roll-up, with the
  // signed contribution: revenue codes add to income, expense codes subtract.
  const accountIds = new Set<string>()
  for (const line of Object.values(gifi.lines)) {
    if (line.schedule !== 'S125') continue
    for (const id of line.accountIds) accountIds.add(id)
  }
  if (accountIds.size === 0) {
    // Nothing pulled (e.g. closing already zeroed the P&L and buildGifi recovered
    // net income another way). Treat all of net income as active.
    return { activeBusinessIncome: netIncome, aggregateInvestmentIncome: 0, investmentAccountIds: [], issues }
  }

  const accounts = await prisma.gLAccount.findMany({
    where: { id: { in: [...accountIds] } },
    select: { id: true, accountClass: true, incomeNature: true },
  })
  const natureById = new Map(accounts.map((a) => [a.id, a]))

  // Aggregate the signed contribution of investment / capital-gains accounts. A
  // revenue account contributes +amount to income; an expense account −amount.
  let aii = 0
  const investmentAccountIds: string[] = []
  for (const line of Object.values(gifi.lines)) {
    if (line.schedule !== 'S125') continue
    if (line.accountIds.length === 0) continue // computed subtotal — skip
    const def = gifiDef(line.code)
    if (def?.subtotal) continue
    for (const id of line.accountIds) {
      const acct = natureById.get(id)
      const nature = acct?.incomeNature ?? null
      if (nature === 'investment' || nature === 'capitalGains') {
        // The line amount may aggregate several accounts; only the passive ones
        // are removed. When a code rolls multiple accounts of MIXED nature the
        // roll-up granularity is the code, so we attribute the whole line — the
        // pre-flight forces a 1:1 passive-account→code mapping, so in practice a
        // passive line has exactly one account.
        const signed = acct?.accountClass === 'expense' ? -round2(line.amount) : round2(line.amount)
        aii = round2(aii + signed)
        investmentAccountIds.push(id)
      }
    }
  }

  // AII is clamped at >= 0 (a net passive LOSS does not create negative AII for
  // the ART/RDTOH base; it simply means no passive income this year).
  const aggregateInvestmentIncome = Math.max(0, round2(aii))
  const activeBusinessIncome = round2(netIncome - aggregateInvestmentIncome)

  if (aggregateInvestmentIncome === 0) {
    // The normal case for this persona — surface as a confirmation, not a block.
    issues.push({
      level: 'warning',
      code: 'AII_ZERO',
      message:
        'Aggregate investment income is $0 (no account is tagged investment/capital gains). ART, RDTOH, Part IV tax, and the dividend refund all correctly compute to $0. Confirm there is no passive income.',
    })
  }

  return { activeBusinessIncome, aggregateInvestmentIncome, investmentAccountIds, issues }
}

/**
 * Opening continuity (ERDTOH / NERDTOH / GRIP, prior-year AAII). Reads the
 * T2ContinuityBalance row for the FYE; prior-year AAII falls back to the prior
 * year's filed T2Return.resultSnapshot when no continuity row exists. All 0 in
 * the first filed year (confirmed via openingConfirmed in the verify gate).
 */
async function pullContinuity(
  fiscalYearEnd: Date,
  taxationYear: number,
): Promise<{
  openingErdtoh: number
  openingNerdtoh: number
  openingGrip: number
  priorYearAaii: number
  openingConfirmed: boolean
  hasRow: boolean
}> {
  const row = await prisma.t2ContinuityBalance.findUnique({
    where: { fiscalYearEnd },
  })

  if (row) {
    return {
      openingErdtoh: toNum(row.openingErdtoh),
      openingNerdtoh: toNum(row.openingNerdtoh),
      openingGrip: toNum(row.openingGrip),
      priorYearAaii: toNum(row.priorYearAaii),
      openingConfirmed: row.openingConfirmed,
      hasRow: true,
    }
  }

  // No continuity row: derive prior-year AAII from the prior filed T2 (0 first
  // year). The prior FYE is one year earlier (full-12-month-year persona).
  const priorFye = new Date(
    Date.UTC(fiscalYearEnd.getUTCFullYear() - 1, fiscalYearEnd.getUTCMonth(), fiscalYearEnd.getUTCDate(), 23, 59, 59, 999),
  )
  const prior = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd: priorFye, status: 'prepared' },
    orderBy: { amendmentSeq: 'desc' },
    select: { resultSnapshot: true },
  })
  const priorYearAaii = readPriorAaii(prior?.resultSnapshot)
  void taxationYear
  return {
    openingErdtoh: 0,
    openingNerdtoh: 0,
    openingGrip: 0,
    priorYearAaii,
    openingConfirmed: false,
    hasRow: false,
  }
}

/** Read aggregateInvestmentIncome from a prior T2Return.resultSnapshot, or 0. */
function readPriorAaii(snapshot: unknown): number {
  if (!snapshot || typeof snapshot !== 'object') return 0
  const snap = snapshot as Record<string, unknown>
  // resultSnapshot is { federal: T2Result, alberta: AT1Result } (or a T2Result).
  const fed = (snap.federal ?? snap) as Record<string, unknown>
  // The prior year's AII is not on T2FederalResult directly; it is the input. The
  // snapshot may carry it under `aggregateInvestmentIncome`. Be defensive.
  const aii = fed['aggregateInvestmentIncome']
  const n = typeof aii === 'number' ? aii : Number(aii)
  return Number.isFinite(n) ? n : 0
}

/**
 * Assemble the full T2 pull: GIFI + dividends + Schedule 8 + the federal/Alberta
 * engine inputs + per-line provenance.
 */
export async function pull(opts: T2PullOptions): Promise<PullResult> {
  const {
    taxationYear,
    fiscalYearStart,
    fiscalYearEnd,
    buildGifi,
    isPersonalServicesBusiness = false,
    taxableCapital = 0,
    allocationFactor = 1.0,
    innovationEmploymentGrant = 0,
    scheduleTwelveAdjustment = 0,
    legacyDividendKind = 'nonEligible',
  } = opts

  const issues: ValidationIssue[] = []

  // ── GIFI roll-up (injected; PRE-CLOSE net income + balance gates) ──────────
  const gifi = await buildGifi()
  issues.push(...gifi.issues)

  // ── Dividends paid (blocker 1) ─────────────────────────────────────────────
  const { dividends: dividendsPaid, issues: divIssues } = await pullDividendsPaid(
    fiscalYearStart,
    fiscalYearEnd,
    legacyDividendKind,
  )
  issues.push(...divIssues)

  // ── Schedule 8 (CCA) projection ────────────────────────────────────────────
  const scheduleEightResult = await scheduleEight(taxationYear)
  issues.push(...scheduleEightResult.issues)

  // ── Active / passive income split (incomeNature) ───────────────────────────
  const split = await splitIncomeNature(gifi)
  issues.push(...split.issues)

  // ── Opening continuity (RDTOH / GRIP / prior-year AAII) ─────────────────────
  const continuity = await pullContinuity(fiscalYearEnd, taxationYear)

  // ── Schedule 1 → taxable income ────────────────────────────────────────────
  // Net income for tax (S1 300) starts at GIFI 9999 and applies the Schedule 8
  // routes: + recapture (107), − CCA (403), − terminal loss (404). The non-CCA
  // book-to-tax add-backs (S1 103 tax provision, 104 amortization, 295 meals,
  // non-deductibles) are layered in by computeT2Federal / buildT2 from the GIFI
  // and meal lines; here the pull supplies the CCA + recapture spine and the
  // raw book net income.
  const bookNetIncome = round2(gifi.netIncome9999)
  const s1 = round2(
    bookNetIncome + scheduleEightResult.totalRecapture - scheduleEightResult.totalCcaClaimed - scheduleEightResult.totalTerminalLoss,
  )

  // For the active-only persona ABI ≈ net income for tax; AII = 0. ABI inherits
  // the CCA/recapture adjustments since the equipment serves the active business.
  const activeBusinessIncome = Math.max(
    0,
    round2(split.activeBusinessIncome + scheduleEightResult.totalRecapture - scheduleEightResult.totalCcaClaimed - scheduleEightResult.totalTerminalLoss),
  )
  const taxableIncome = s1

  // ── Federal engine input ───────────────────────────────────────────────────
  const federalInput: T2FederalInput = {
    taxationYear,
    taxableIncome,
    activeBusinessIncome,
    aggregateInvestmentIncome: split.aggregateInvestmentIncome,
    priorYearAaii: continuity.priorYearAaii,
    taxableCapital,
    // Portfolio dividends received drive Part IV; 0 for the active-only persona
    // (no passive portfolio). Surfaced as opt-in lines by buildT2 when present.
    portfolioDividendsReceived: 0,
    eligiblePortfolioDividends: 0,
    nonEligiblePortfolioDividends: 0,
    eligibleDividendsPaid: dividendsPaid.eligible,
    nonEligibleDividendsPaid: dividendsPaid.nonEligible,
    openingErdtoh: continuity.openingErdtoh,
    openingNerdtoh: continuity.openingNerdtoh,
    openingGrip: continuity.openingGrip,
    eligibleDividendsReceived: 0,
    isPersonalServicesBusiness,
  }

  // ── Alberta engine input ───────────────────────────────────────────────────
  // AB taxable income = federal TI ± Schedule 12 (default 0). The reduced business
  // limit is the federal one; computeAt1 receives the federal limit via buildT2
  // (the federal engine computes it). Here we pass the federal businessLimit
  // CEILING and let computeAt1 inherit the reduced figure from the federal result;
  // for the pull-level input we supply $500k as the AB statutory limit and the
  // federal result narrows it. To keep the input pure, the reducedBusinessLimit is
  // the un-ground statutory limit; buildT2 overrides it with the federal reduced
  // limit before computeAt1 runs.
  const albertaInput: At1Input = {
    taxationYear,
    albertaTaxableIncome: round2(taxableIncome + scheduleTwelveAdjustment),
    activeBusinessIncome,
    reducedBusinessLimit: 500000,
    allocationFactor,
    innovationEmploymentGrant,
    isPersonalServicesBusiness,
  }

  // ── Materialize lines + provenance ─────────────────────────────────────────
  const lines: T2Lines = {}
  const pulledRefs: PulledRefs = {}

  // GIFI carries (the roll-up codes the worksheet/S1 reference).
  for (const [code, gl] of Object.entries(gifi.lines)) {
    const key = `GIFI:${code}`
    lines[key] = round2(gl.amount)
    if (gl.accountIds.length > 0) {
      pulledRefs[key] = { source: 'GL', ids: [...gl.accountIds].sort(), total: round2(gl.amount) }
    }
  }

  // Schedule 8 per-class rows + the S1 routes.
  for (const row of scheduleEightResult.rows) {
    const key = `S8:${row.classNumber}`
    lines[key] = round2(row.ccaClaimed)
  }
  setLine(lines, pulledRefs, 'S1:403', scheduleEightResult.totalCcaClaimed, 'CCA', ccaClassRefIds(scheduleEightResult.rows))
  if (scheduleEightResult.totalRecapture > 0) {
    setLine(lines, pulledRefs, 'S1:107', scheduleEightResult.totalRecapture, 'CCA', [])
  }
  if (scheduleEightResult.totalTerminalLoss > 0) {
    setLine(lines, pulledRefs, 'S1:404', scheduleEightResult.totalTerminalLoss, 'CCA', [])
  }

  // Schedule 1 net income for tax (300).
  setLine(lines, pulledRefs, 'S1:300', taxableIncome, 'GL', [])

  // Dividends paid → Schedule 3 Part 2 + retained-earnings GIFI 3700.
  setLine(lines, pulledRefs, 'S3:eligible', dividendsPaid.eligible, 'JE', dividendsPaid.journalEntryLineIds)
  setLine(lines, pulledRefs, 'S3:nonEligible', dividendsPaid.nonEligible, 'JE', dividendsPaid.journalEntryLineIds)
  setLine(lines, pulledRefs, 'GIFI:3700', dividendsPaid.total, 'JE', dividendsPaid.journalEntryLineIds)

  return {
    lines,
    pulledRefs,
    gifi,
    scheduleEight: scheduleEightResult,
    dividendsPaid,
    federalInput,
    albertaInput,
    issues,
  }
}

/** Set a line value + its provenance ref (skips empty-id refs to avoid noise). */
function setLine(
  lines: T2Lines,
  refs: PulledRefs,
  key: string,
  value: number,
  source: PulledRef['source'],
  ids: string[],
): void {
  lines[key] = round2(value)
  if (ids.length > 0) {
    refs[key] = { source, ids: [...new Set(ids)].sort(), total: round2(value) }
  }
}

/** The class refs that contributed CCA, for the S1:403 provenance ref. */
function ccaClassRefIds(rows: { classNumber: string }[]): string[] {
  return rows.map((r) => `class:${r.classNumber}`)
}
