/**
 * T2 module — shared contracts.
 *
 * These types are the single source of truth every downstream T2 agent codes
 * against: the pure compute engines (computeT2Federal.ts / computeAt1.ts /
 * computeGifi.ts / scheduleEight.ts), the GL/dividend/CCA pull (pull.ts), the
 * GIFI builder (buildGifi.ts), the build/verify pipeline (buildT2.ts), the
 * re-key-worksheet export (export.ts), the rate tables (rates/*), and the route
 * + UI layers.
 *
 * SCOPE v1 (the real filer): an owner-managed CCPC, ALBERTA-resident, DECEMBER-31
 * fiscal year-end, FULL 12-month years only, ACTIVE business income only
 * (negligible/zero passive), SINGLE shareholder, paid via the corporation's OWN
 * dividends. The app PREPARES & VERIFIES the return + the Alberta AT1; it can
 * NEVER transmit (no CRA Corporation Internet Filing, no TRA Net File). The
 * primary deliverable is a TWO-PDF re-key worksheet (federal T2 + Alberta AT1)
 * the owner transcribes into certified software; the line-by-line totals are a
 * reconciliation/verification artifact only.
 *
 * All money is plain `number` (CAD dollars). GIFI amounts are whole dollars
 * (roundDollar); tax-calc figures are 2-dp (round2) — both from '@/lib/tax/round'.
 * Lines are keyed by a STRING "form:line" (e.g. "S1:300", "S8:217", "S3:460",
 * "GIFI:2599", "AT1:070") so federal + Alberta + GIFI lines coexist in one map.
 *
 * Pure data/contracts only — NO I/O in this file.
 */

import type { DividendKind } from '@/lib/tax/compute/t5'

// ---------------------------------------------------------------------------
// Line storage
// ---------------------------------------------------------------------------

/**
 * "form:line" (string) -> dollar amount. Used for both engine-computed `lines`
 * and manual `linesOverride`. Effective value of a line `k` is
 * `linesOverride[k] ?? lines[k]`. Form prefixes in v1: "GIFI", "S1", "S3", "S7",
 * "S8", "T2" (page-3 carries), "AT1".
 */
export type T2Lines = Record<string, number>

/** Alberta AT1 line storage — same shape, keyed "AT1:<line>". */
export type AT1Lines = Record<string, number>

/**
 * Active/passive nature of an income/expense GL account — drives the whole CCPC
 * machinery (AII / ART / RDTOH / Part IV / SBD grind). `active` is the default
 * for operating income; `investment` is portfolio/interest/rental/royalty;
 * `capitalGains` is a taxable capital gain. Null = unclassified (the pre-flight
 * forces a choice only for passive-looking accounts; everything else defaults
 * to 'active').
 */
export type IncomeNature = 'active' | 'investment' | 'capitalGains'

// ---------------------------------------------------------------------------
// GIFI (Schedules 100 / 125 / 141)
// ---------------------------------------------------------------------------

/** Which GIFI schedule a code rolls up into. */
export type GifiSchedule = 'S100' | 'S125'

/**
 * One rolled GIFI line: the 4-digit code, the schedule it sits on, its label,
 * the whole-dollar amount, and the source GL account ids that fed it (provenance
 * for the export + the unmapped-account gate). Subtotal/total codes carry an
 * empty `accountIds` (computed in-engine, not pulled from a single account).
 */
export interface GifiLine {
  code: string
  schedule: GifiSchedule
  label: string
  amount: number
  accountIds: string[]
  /** true for engine-computed subtotals/totals (e.g. 2599, 3499, 9999). */
  computed: boolean
}

/**
 * GIFI build result — the rolled income statement (S125) + balance sheet (S100),
 * the key carry figures, and the rounding plug applied to keep the accounting
 * identity intact after independent whole-dollar rounding.
 *
 * Net income (9999) is computed PRE-CLOSE: kind='closing' journal entries are
 * EXCLUDED so the year-end closing entry zeroing income/expense accounts does not
 * break the 3680 = 9999 gate. retainedEarningsEnd = RE-start + netIncome −
 * dividendsDeclared.
 */
export interface GifiResult {
  /** every rolled line, keyed by GIFI code. */
  lines: Record<string, GifiLine>
  /** S125 net income after tax — GIFI 9999. */
  netIncome9999: number
  /** S100 total assets — GIFI 2599. */
  totalAssets2599: number
  /** S100 total liabilities — GIFI 3499. */
  totalLiabilities3499: number
  /** S100 total equity — GIFI 3620. */
  totalEquity3620: number
  /** retained earnings, end of year — GIFI 3600 (the continuity + plug home). */
  retainedEarnings3600: number
  /** dividends declared in the fiscal window — GIFI 3700. */
  dividendsDeclared3700: number
  /** the residual whole-dollar rounding plug posted to RE (3600); may be 0. */
  roundingPlug: number
  /** true when a kind='closing' entry is already posted in the window (warn). */
  closingEntryPosted: boolean
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Schedule 8 (CCA) projection
// ---------------------------------------------------------------------------

/** One Schedule 8 class row — the projection of the CCA engine's class-year. */
export interface ScheduleEightRow {
  classNumber: string
  description: string
  openingUcc: number
  additions: number
  dispositions: number
  /** AccII / immediate-expensing first-year uplift addition for the year. */
  acciiAddition: number
  halfYearAdjustment: number
  ccaBase: number
  ccaRate: number
  ccaClaimed: number
  closingUcc: number
  /** method actually applied (half_year | accii | diep | full | none). */
  method: string
  /** closing < 0 ⇒ recapture into income (S1 line 107 addition). */
  recapture: boolean
  /** UCC remains, class empty ⇒ terminal loss (S1 line 404 deduction). */
  terminalLoss: boolean
}

/** Schedule 8 result — per-class rows + the totals that route into Schedule 1. */
export interface ScheduleEightResult {
  rows: ScheduleEightRow[]
  /** Σ ccaClaimed across classes — Schedule 1 line 403 (CCA deduction). */
  totalCcaClaimed: number
  /** Σ recapture amounts — Schedule 1 line 107 (addition). */
  totalRecapture: number
  /** Σ terminal losses — Schedule 1 line 404 (deduction). */
  totalTerminalLoss: number
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Dividend sourcing (mirrors computeT5: posted JE debits to the declared acct)
// ---------------------------------------------------------------------------

/**
 * Dividends PAID in the fiscal window, sourced exactly like computeT5: posted
 * journal-entry DEBITS to CompanySettings.dividendsDeclaredAccountId, grouped by
 * JournalEntry.dividendEligibility (null → falls back to slip kind). This single
 * source feeds Schedule 3 Part 2, retained-earnings GIFI 3700, the dividend
 * refund, and the GRIP gate.
 */
export interface DividendsPaid {
  eligible: number
  nonEligible: number
  total: number
  /** the configured declared-account id (null ⇒ ERROR, not configured). */
  dividendsDeclaredAccountId: string | null
  /** posted JE line ids consumed (provenance / drift). */
  journalEntryLineIds: string[]
}

// ---------------------------------------------------------------------------
// Federal CCPC compute (Part I / SBD / ART / Part IV / RDTOH / GRIP / refund)
// ---------------------------------------------------------------------------

/**
 * Inputs to computeT2Federal — the pure federal engine. All amounts CAD. The
 * caller (buildT2/pull) assembles these from the GIFI income statement, the
 * incomeNature split, Schedule 8, the dividend pull, and the continuity record.
 */
export interface T2FederalInput {
  taxationYear: number
  /** net income for tax (Schedule 1 line 300). */
  taxableIncome: number
  /** active business income (ABI) — the SBD base before limits. */
  activeBusinessIncome: number
  /** aggregate investment income (AII) — 0 for the active-only persona. */
  aggregateInvestmentIncome: number
  /** prior-year AAII (drives the SBD passive grind; 0 for this persona). */
  priorYearAaii: number
  /** taxable capital employed in Canada (drives the $10M–$50M grind; ~0 here). */
  taxableCapital: number
  /** portfolio taxable dividends received (Part IV base; usually 0). */
  portfolioDividendsReceived: number
  /** split of portfolio dividends received that are eligible vs non-eligible. */
  eligiblePortfolioDividends: number
  nonEligiblePortfolioDividends: number
  /** dividends PAID this year, by pool (from the dividend pull). */
  eligibleDividendsPaid: number
  nonEligibleDividendsPaid: number
  /** opening continuity balances (prior year's filed closing). */
  openingErdtoh: number
  openingNerdtoh: number
  openingGrip: number
  /** eligible dividends RECEIVED (adds to GRIP room). */
  eligibleDividendsReceived: number
  /** personal-services-business flag (ITA 123.5 +5%, no SBD, no GRR). */
  isPersonalServicesBusiness: boolean
}

/** Federal computation result (pure output of computeT2Federal). */
export interface T2FederalResult {
  taxationYear: number
  /** Schedule 1 line 300. */
  taxableIncome: number
  /** TI − sbdIncome − AII (ITA 123.4 full-rate taxable income). */
  fullRateTaxableIncome: number
  /** SBD income actually deducted = min(ABI, businessLimit, TI). */
  sbdIncome: number
  /** reduced business limit = max(0, 500000 − grind). */
  businessLimit: number
  /** the SBD grind = max(taxableCapitalGrind, priorYearAaiiGrind). */
  sbdGrind: number
  /** Part I tax (line 700) including ART and any PSB additional tax. */
  partOneTax: number
  /** additional refundable tax on AII (line 604) = 0.1067 × min(AII, TI). */
  art: number
  /** PSB additional tax (ITA 123.5) = 0.05 × PSB taxable income; 0 normally. */
  psbAdditionalTax: number
  /** Part IV tax = 0.3833 × portfolio dividends received. */
  partFourTax: number
  /** eligible / non-eligible Part IV split (drives ERDTOH/NERDTOH additions). */
  eligiblePartFour: number
  nonEligiblePartFour: number
  /** closing ERDTOH balance (→ next year's opening). */
  closingErdtoh: number
  /** closing NERDTOH balance (→ next year's opening). */
  closingNerdtoh: number
  /** dividend refund, pool-split (line 784) with 129(1) ordering. */
  dividendRefund: number
  eligibleRefund: number
  nonEligibleRefund: number
  /** closing GRIP (→ next year's opening) and the room the gate tested against. */
  closingGripBeforeDivs: number
  closingGrip: number
  /** true when eligible dividends paid exceed closing GRIP room (185.1 risk). */
  gripOverDesignated: boolean
  /** every federal line the engine computed, keyed "form:line". */
  lines: T2Lines
  engineVersion: string
}

// ---------------------------------------------------------------------------
// Alberta AT1 compute
// ---------------------------------------------------------------------------

/** Inputs to computeAt1 — the pure Alberta engine. */
export interface At1Input {
  taxationYear: number
  /** Alberta taxable income (federal TI ± Schedule 12 adjustments, default 0). */
  albertaTaxableIncome: number
  /** active business income for the AB 2% small-business rate. */
  activeBusinessIncome: number
  /** the federal REDUCED business limit (AB inherits it, never recomputes AAII). */
  reducedBusinessLimit: number
  /** income allocation factor (1.0 for a single Alberta PE). */
  allocationFactor: number
  /** Innovation Employment Grant credit (AT1 line 129), default 0. */
  innovationEmploymentGrant: number
  /** PSB flag (no AB SBD when set). */
  isPersonalServicesBusiness: boolean
}

/** Alberta AT1 computation result (pure output of computeAt1). */
export interface At1Result {
  taxationYear: number
  albertaTaxableIncome: number
  /** AB small-business income = min(ABI, reducedLimit × allocation). */
  albertaSbdIncome: number
  /** AB SBD deduction (the 6-point spread → 2% effective). */
  albertaSbdAmount: number
  /** general-rate income taxed at 8%. */
  generalRateIncome: number
  /** Alberta tax @ 8% general / 2% small business, before credits. */
  taxBeforeCredits: number
  /** IEG credit applied (line 129). */
  innovationEmploymentGrant: number
  /** net Alberta tax payable (line 072), clamped ≥ 0. */
  albertaTaxPayable: number
  /** every AT1 line the engine computed, keyed "AT1:<line>". */
  lines: AT1Lines
  engineVersion: string
}

// ---------------------------------------------------------------------------
// Combined T2 result
// ---------------------------------------------------------------------------

/** The full prepared-return result: GIFI + Schedule 8 + federal + Alberta. */
export interface T2Result {
  taxationYear: number
  fiscalYearStart: string // ISO date
  fiscalYearEnd: string // ISO date
  daysInYear: number
  province: string
  gifi: GifiResult
  scheduleEight: ScheduleEightResult
  dividendsPaid: DividendsPaid
  federal: T2FederalResult
  alberta: At1Result
  /** the merged "form:line" map across GIFI/S1/S3/S7/S8/T2/AT1. */
  lines: T2Lines
  engineVersion: string
}

// ---------------------------------------------------------------------------
// Line descriptors (the declarative builder/registry shape)
// ---------------------------------------------------------------------------

/** How a line gets its value in the builder UI. */
export type LineSource = 'pull' | 'manual' | 'computed'

/** Section of the T2/AT1 a line belongs to (drives the builder cards/tabs). */
export type T2Section =
  | 'identity'
  | 'gifiBalanceSheet'
  | 'gifiIncomeStatement'
  | 'schedule1'
  | 'schedule8'
  | 'schedule3'
  | 'federalTax'
  | 'alberta'
  | 'summary'

/** Which return a line belongs to. */
export type T2Form = 'GIFI' | 'S1' | 'S3' | 'S7' | 'S8' | 'T2' | 'AT1'

/**
 * T2 line descriptor: the "form:line"-keyed analogue of T1LineDescriptor.
 * Declares each line's form, number, label, section, source, optional validation
 * — drives ReturnFormBuilder/LineField rendering and the descriptor registry.
 */
export interface T2LineDescriptor {
  /** form prefix (e.g. "S1"). */
  form: T2Form
  /** line number within the form (e.g. "300"). */
  line: string
  /** full key into T2Lines = `${form}:${line}`. */
  key: string
  label: string
  section: T2Section
  source: LineSource
  help?: string
  /** per-line validation; returns an error string or null. */
  validate?: (value: number, all: T2Lines) => string | null
  /** true for lines that render only when their opt-in section is enabled. */
  optIn?: boolean
}

// ---------------------------------------------------------------------------
// Validation / verify-before-prepare
// ---------------------------------------------------------------------------

export type ValidationLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: ValidationLevel
  code: string
  message: string
  /** optional "form:line" this issue attaches to. */
  line?: string
  /** optional GL account id (unmapped/untagged-account gates). */
  accountId?: string
}

/**
 * Verify-before-prepare report. `ok === false` (any error) blocks marking the
 * return prepared and forces a DRAFT-watermarked export. Mirrors the T1
 * ValidationReport shape.
 */
export interface ValidationReport {
  ok: boolean
  checkedAt: string
  taxationYear: number
  province: string
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Pull provenance + drift
// ---------------------------------------------------------------------------

/** Where a pulled line came from. */
export type PullSource = 'GL' | 'CCA' | 'JE' | 'T5'

/**
 * Provenance for a pulled line: which source fed it and the underlying ids, so
 * recompute can detect drift. Stored as pulledRefs[key] on the T2Return.
 */
export interface PulledRef {
  source: PullSource
  /** underlying ids consumed (GL account ids, JE line ids, CCA entry ids). */
  ids: string[]
  /** summed value written to the line. */
  total: number
}

/** Map of "form:line" -> provenance. Stored on T2Return.pulledRefs. */
export type PulledRefs = Record<string, PulledRef>

/** Result of pulling GL/CCA/dividends into T2 lines (pure-ish adapter output). */
export interface PullResult {
  lines: T2Lines
  pulledRefs: PulledRefs
  gifi: GifiResult
  scheduleEight: ScheduleEightResult
  dividendsPaid: DividendsPaid
  /** the federal-engine input assembled from the pulled data. */
  federalInput: T2FederalInput
  /** the Alberta-engine input assembled from the pulled data. */
  albertaInput: At1Input
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Re-key worksheet export (the PRIMARY deliverable — TWO PDFs)
// ---------------------------------------------------------------------------

/**
 * One re-key line on a worksheet: the form line number, label, amount, and
 * provenance microcopy ("from GL 8521", "Σ Schedule 8", "posted dividend JEs").
 */
export interface WorksheetLine {
  /** form line number as printed in certified software (e.g. "300", "430"). */
  line: string
  label: string
  amount: number
  /** human provenance for the line (where the number came from). */
  provenance: string
}

/** One worksheet = one return (federal T2 OR Alberta AT1) the owner re-keys. */
export interface ReKeyWorksheet {
  /** "T2" (federal) or "AT1" (Alberta). */
  form: 'T2' | 'AT1'
  title: string
  lines: WorksheetLine[]
}

/**
 * Corporate identification jacket carried in the export. The single-shareholder
 * SIN (Schedule 50) appears ONLY in the in-memory regenerated export, never
 * persisted; the UI shows masked values.
 */
export interface T2ExportIdentification {
  legalName: string
  /** 9-digit BN + RC0001 program account. */
  bnRc: string
  /** 10-digit Alberta Corporate Account Number. */
  albertaCan: string
  province: string
  fiscalYearStart: string // ISO
  fiscalYearEnd: string // ISO
  /** single-shareholder name (Schedule 50). */
  shareholderName: string | null
  /** single-shareholder SIN — full, in-memory only. */
  shareholderSin: string | null
}

/**
 * The complete prepare-&-verify export: two re-key worksheets (federal + Alberta)
 * plus the reconciliation line map and the full result/report. Persistence is
 * checksum-only; the payload regenerates on authorized download.
 */
export interface T2Export {
  taxationYear: number
  province: string
  identification: T2ExportIdentification
  /** [federal T2 worksheet, Alberta AT1 worksheet]. */
  worksheets: ReKeyWorksheet[]
  /** verification-only merged line totals (NOT the primary re-key surface). */
  reconciliationLines: T2Lines
  result: T2Result
  report: ValidationReport
  /** key filing/balance-due dates surfaced for the owner. */
  dates: FilingDates
  engineVersion: string
  /** sha256 of the canonical export payload (persisted; payload is not). */
  checksum: string
}

/** Surfaced corporate filing + balance-due dates (computed from the FYE). */
export interface FilingDates {
  fiscalYearEnd: string // ISO
  /** T2/AT1 filing deadline = FYE + 6 months. */
  filingDue: string // ISO
  /** balance-due date = FYE + 3 months for an SBD-claiming CCPC. */
  balanceDue: string // ISO
}

// ---------------------------------------------------------------------------
// engineVersion convention
// ---------------------------------------------------------------------------

/**
 * The compute-engine semver. Bump on any change to the federal/Alberta/GIFI
 * compute math so a prepared return reopened under different logic forces an
 * explicit re-prepare.
 */
export const T2_COMPUTE_SEMVER = '1.0.0'

/**
 * engineVersion = "{computeSemver}+{rateYear}+{fedHash}+{abHash}+{acciiYear}".
 *  - computeSemver: T2_COMPUTE_SEMVER
 *  - rateYear:      the rate table's taxationYear (e.g. "2025")
 *  - fedHash:       short hash of the federal rate profile
 *  - abHash:        short hash of the Alberta rate profile
 *  - acciiYear:     the AccII table year the Schedule 8 projection used
 *
 * Reopening a prepared return whose recomputed string differs from the stored one
 * forces an explicit re-prepare (never a silent recompute). The acciiYear segment
 * makes an AccII-table fix force re-prepare (blocker 4).
 */
export function makeEngineVersion(
  rateYear: number,
  fedHash: string,
  abHash: string,
  acciiYear: number,
): string {
  return `${T2_COMPUTE_SEMVER}+${rateYear}+${fedHash}+${abHash}+${acciiYear}`
}

// Re-export the dividend kind so T2 consumers share one definition with T1/T5.
export type { DividendKind }
