/**
 * T1 module — shared contracts.
 *
 * These types are the single source of truth every downstream T1 agent codes
 * against: the pure compute engine (compute.ts), the slip pull (pull.ts), the
 * build/verify pipeline (buildT1.ts), the per-slip transcription export
 * (export.ts), the rate tables (rates/*), and the route + UI layers.
 *
 * SCOPE v1 (the real filer): a MARRIED, full-year ALBERTA resident CCPC owner
 * paid PERSONALLY via the company's own T5 dividends (eligible and/or
 * non-eligible), NO foreign income, NO T4 salary. The app PREPARES & VERIFIES
 * the return — it can NEVER NETFILE. The primary deliverable is a per-SLIP box
 * transcription sheet (what the owner re-keys into certified software); the T1
 * line-by-line totals are a RECONCILIATION/verification artifact only.
 *
 * All money is plain `number` (CAD dollars). Rounding is via round2/roundDollar
 * from '@/lib/tax/round'. Lines are keyed by CRA line number as a STRING (e.g.
 * "12000", "30300", "58120") to match TaxSlip.boxes' string-keyed JSON.
 *
 * Pure data/contracts only — NO I/O in this file.
 */

import type { DividendKind } from '@/lib/tax/compute/t5'

// ---------------------------------------------------------------------------
// Line storage
// ---------------------------------------------------------------------------

/**
 * CRA line number (string) -> dollar amount. Used for both engine-computed
 * `lines` and manual `linesOverride`. Effective value of a line `k` is
 * `linesOverride[k] ?? lines[k]` (mirrors effectiveBoxes()).
 */
export type T1Lines = Record<string, number>

/** Marital status as captured on the return (CRA categories). */
export type MaritalStatus =
  | 'single'
  | 'married'
  | 'commonLaw'
  | 'separated'
  | 'divorced'
  | 'widowed'

/** True when a spouse/partner exists and the spouse-amount tests must run. */
export const COUPLED_STATUSES: readonly MaritalStatus[] = ['married', 'commonLaw']

// ---------------------------------------------------------------------------
// Rate tables / province profiles
// ---------------------------------------------------------------------------

/** One progressive tax bracket: `rate` applies to income above `upTo`'s lower edge. */
export interface Bracket {
  /** marginal rate, e.g. 0.145 for 14.5%. */
  rate: number
  /** upper bound of this bracket (income up to this amount); Infinity for the top. */
  upTo: number
}

/**
 * Basic Personal Amount config. AB has a flat BPA (no phase-out, phaseOut:null).
 * Federal BPA phases DOWN from `max` to `min` across `start`→`end` of net income
 * (this is REAL, not a no-op).
 */
export interface BpaConfig {
  /** maximum BPA (claimed at/below `phaseOut.start` net income). */
  max: number
  /** minimum BPA (floor at/above `phaseOut.end` net income). */
  min: number
  /**
   * Net-income phase-out band. `null` → flat BPA = `max` (Alberta). When set,
   * the BPA is reduced linearly from `max` (at `start`) to `min` (at `end`).
   */
  phaseOut: { start: number; end: number } | null
}

/** Dividend tax credit rates as a fraction of the GROSSED-UP (taxable) amount. */
export interface DtcRates {
  /** eligible DTC as a fraction of box-25/49 taxable (fed 0.150198, AB 0.0812). */
  eligible: number
  /** non-eligible DTC as a fraction of box-11/23 taxable (fed 0.090301, AB 0.0218). */
  nonEligible: number
}

/**
 * Charitable-donation credit tiers. First `firstTierCap` of donations is valued
 * at `firstRate`; the remainder at `remainderRate`. The federal third tier (33%
 * on donations over $200 to the extent taxable income exceeds the top bracket)
 * is modeled via `topRate` + `topThreshold` (null for provinces without it, incl.
 * Alberta).
 */
export interface DonationTiers {
  firstTierCap: number // 200
  firstRate: number // fed 0.145 ; AB 0.60
  remainderRate: number // fed 0.29 ; AB 0.21
  /** federal high-income tier rate (0.33) or null. */
  topRate: number | null
  /** taxable-income threshold above which the top rate applies, or null. */
  topThreshold: number | null
}

/**
 * Spouse-amount config — the base BPA-equivalent the spouse claim reduces by the
 * spouse's net income. Federal uses the (phase-out-adjusted) federal BPA base;
 * Alberta uses the FULL flat AB BPA with NO phase-out (different base — must NOT
 * be collapsed into one number).
 *
 * Federal 30300 = max(0, fedBpaAfterPhaseOut − spouseNetIncome) × creditRate
 * Alberta 58120 = max(0, base(22,323)           − spouseNetIncome) × creditRate
 *
 * `base` is null for the federal profile (use the live phased BPA at compute
 * time); a fixed number for Alberta.
 */
export interface SpouseAmountConfig {
  /** fixed base (AB 22,323) or null to use the jurisdiction's live BPA. */
  base: number | null
}

/**
 * Age amount (line 30100 fed / 58080 AB) — income-tested, DOB-driven. `max` less
 * `rate` × (net income − `clawbackStart`), floored at 0. For a working-age owner
 * this computes to $0; the line and DOB must still exist.
 */
export interface AgeAmountConfig {
  max: number
  clawbackStart: number
  rate: number
  /** age (years) at year-end at/above which the amount may be claimed (65). */
  qualifyingAge: number
}

/**
 * Medical-expense floor (line 33099/33199 fed; AB analogue): eligible expenses
 * less min(`fixedFloor`, `rate` × net income), valued at the jurisdiction credit
 * rate. Marked [VERIFY] for 2025 — non-load-bearing unless medical is opted in.
 */
export interface MedicalFloorConfig {
  fixedFloor: number
  rate: number
}

/**
 * Pluggable per-jurisdiction tax profile (federal and each province). The engine
 * is generic over this; provinces add surtaxes / supplemental credits without
 * touching the core.
 */
export interface ProvinceTaxProfile {
  /** "federal" | "AB" | … — identifies the jurisdiction. */
  jurisdiction: string
  /** tax year these figures apply to. */
  taxYear: number
  brackets: Bracket[]
  bpa: BpaConfig
  /** non-refundable credit valuation rate (fed 0.145, AB 0.08). */
  creditRate: number
  dtc: DtcRates
  donationTiers: DonationTiers
  spouseAmount: SpouseAmountConfig
  ageAmount: AgeAmountConfig
  medical: MedicalFloorConfig
  /**
   * Gated supplemental/top-up credit (fed line 34990 "Top-Up", or the AB
   * supplemental credit). Returns the credit dollar amount; MUST return 0 for the
   * canonical dividend-only filer (below thresholds). Implemented as a gated hook.
   */
  supplementalCredit?: (ctx: SupplementalCreditContext) => number
  /** provincial surtax fn (ON etc.) or null (Alberta has none). */
  surtax: ((tax: number) => number) | null
  /** when true the jurisdiction is not supported in v1 (e.g. Quebec). */
  unsupported?: true
}

/**
 * Inputs to the gated supplemental/top-up hook. `creditBaseAmounts` is the sum of
 * the underlying credit BASE dollar amounts (BPA, donations-first-tier, etc.),
 * NOT the already-valued (×rate) credit dollars.
 */
export interface SupplementalCreditContext {
  taxYear: number
  netIncome: number
  taxableIncome: number
  /** Σ of NRTC base amounts (pre-valuation), used by the federal Top-Up gate. */
  creditBaseAmounts: number
  /** Σ of provincial personal-credit amounts, used by the AB supplemental gate. */
  provincialCreditAmounts: number
}

/** A complete year's rate set: the federal profile + one province profile. */
export interface RateTable {
  taxYear: number
  province: string
  federal: ProvinceTaxProfile
  provincial: ProvinceTaxProfile
  /** semantic version of the rate-table data, folded into engineVersion. */
  rateVersion: string
}

// ---------------------------------------------------------------------------
// Compute result
// ---------------------------------------------------------------------------

/** Dividend sub-totals threaded through the income-tested credit math. */
export interface DividendBreakdown {
  /** Σ eligible taxable (box 25/49) — line 12000 portion. */
  taxableEligible: number
  /** Σ non-eligible taxable (box 11/23) — line 12010 (and part of 12000). */
  taxableNonEligible: number
  /** Σ federal DTC consumed from slip boxes 12/26/39/51 — line 40425. */
  federalDtc: number
}

/** Per-jurisdiction tax computation breakdown (federal or provincial). */
export interface JurisdictionResult {
  jurisdiction: string
  /** gross tax from brackets on taxable income (line 26000). */
  grossTax: number
  /** Σ non-refundable tax credits valued at the jurisdiction rate (NRTC value). */
  nonRefundableCredits: number
  /** donation credit value (tiered). */
  donationCredit: number
  /** dividend tax credit (fed consumed from 40425; AB RECOMPUTED at 8.12/2.18%). */
  dividendTaxCredit: number
  /** gated supplemental/top-up credit value (0 for the canonical filer). */
  supplementalCredit: number
  /** spouse-amount credit value (30300 fed / 58120 AB), 0 when not coupled. */
  spouseAmountCredit: number
  /** surtax (provincial; 0 for AB). */
  surtax: number
  /**
   * net tax after credits, CLAMPED at 0 (no excess non-refundable credit may
   * create a refund). 42000 (fed) / 42800 (AB).
   */
  netTax: number
}

/** Full T1 computation result (pure output of computeT1). */
export interface T1Result {
  taxYear: number
  province: string
  /** every CRA line the engine computed, keyed by line number. */
  lines: T1Lines
  totalIncome: number // 15000
  netIncome: number // 23600 (grossed-up — drives ALL income-tested credits)
  taxableIncome: number // 26000
  dividends: DividendBreakdown
  federal: JurisdictionResult
  provincial: JurisdictionResult
  totalPayable: number // 43500 = 42000 + 42800
  totalCredits: number // 43700 withheld + 47600 instalments + refundable
  /** positive when a refund (line 48400), 0 otherwise. */
  refund: number
  /** positive when a balance owing (line 48500), 0 otherwise. */
  balanceOwing: number
  /** engine version string this result was computed under. */
  engineVersion: string
}

// ---------------------------------------------------------------------------
// Line descriptors (the box-descriptor analogue, keyed by line)
// ---------------------------------------------------------------------------

/** How a line gets its value in the builder UI. */
export type LineSource = 'pull' | 'manual' | 'computed'

/** Section of the T1 a line belongs to (drives the collapsible builder cards). */
export type T1Section =
  | 'identity'
  | 'income'
  | 'deductions'
  | 'taxableIncome'
  | 'federalTax'
  | 'provincialTax'
  | 'summary'

/**
 * T1 line descriptor: the line-keyed analogue of BoxDescriptor. Declares each
 * line's CRA number, label, section, source, and optional validation — drives
 * ReturnFormBuilder/LineField rendering and the descriptor registry.
 */
export interface T1LineDescriptor {
  /** CRA line number, e.g. "12000". Also the key into T1Lines. */
  line: string
  label: string
  section: T1Section
  source: LineSource
  /** jurisdiction the line belongs to ("federal" | "AB" | "both"). */
  jurisdiction: 'federal' | 'AB' | 'both'
  /** optional microcopy (e.g. the 47600 instalment guidance). */
  help?: string
  /** per-line validation; returns an error string or null. */
  validate?: (value: number, all: T1Lines) => string | null
  /** true for lines that should only render when their opt-in section is enabled. */
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
  /** optional CRA line or slip this issue attaches to. */
  line?: string
  slipId?: string
}

/**
 * Verify-before-prepare report. `ok === false` (any error) blocks marking the
 * return prepared and forces a DRAFT-watermarked export. Mirrors filing.ts's
 * ValidationReport shape.
 */
export interface ValidationReport {
  ok: boolean
  checkedAt: string
  taxYear: number
  province: string
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Slip pull (provenance + drift)
// ---------------------------------------------------------------------------

/**
 * Provenance for a pulled line: which logical slip(s) fed it and at what
 * amendmentSeq, so recompute can detect amendment drift (effective seq > stored
 * seq → stale). Stored as pulledRefs[line] on the T1Return.
 */
export interface PulledRef {
  /** the slip type the value came from. */
  slipType: 'T5' | 'T4A' | 'T3'
  /** logical slip number(s) consumed (NOT row ids — amendments change the id). */
  slipNumbers: string[]
  /** row ids of the effective slips consumed (for deep-linking). */
  slipIds: string[]
  /** highest effective amendmentSeq consumed at pull time (drift comparison). */
  amendmentSeq: number
  /** summed effective value written to the line. */
  total: number
}

/** Map of CRA line number -> provenance. Stored on T1Return.pulledRefs. */
export type PulledRefs = Record<string, PulledRef>

/** Result of pulling slips into T1 lines (pure-ish adapter output). */
export interface PullResult {
  lines: T1Lines
  pulledRefs: PulledRefs
  dividends: DividendBreakdown
  issues: ValidationIssue[]
}

// ---------------------------------------------------------------------------
// Per-slip transcription export (the PRIMARY deliverable)
// ---------------------------------------------------------------------------

/** One CRA box on a transcription card: number + label + amount. */
export interface TranscriptionBox {
  /** official CRA box number printed on the slip, e.g. "25". */
  boxNumber: string
  label: string
  amount: number
}

/**
 * One card = one slip the owner re-keys into certified software's slip screen.
 * This is what the user actually transcribes; the T1 line totals are only a
 * cross-check.
 */
export interface SlipTranscriptionCard {
  slipType: 'T5' | 'T4A' | 'T3'
  /** issuer/payer label (e.g. the company name) for the slip screen. */
  issuerLabel: string
  /** logical slip number, when allocated. */
  slipNumber: string | null
  boxes: TranscriptionBox[]
}

/** A non-slip item the user enters by hand in certified software. */
export interface NonSlipItem {
  /** stable key, e.g. "rrsp" | "instalments" | "capitalGains". */
  key: string
  label: string
  /** CRA line it maps to in certified software. */
  line: string
  amount: number
  /** optional microcopy (e.g. "from your latest NOA"). */
  help?: string
}

/**
 * Identification jacket carried in the export. SIN/DOB are present ONLY in the
 * in-memory regenerated export (never persisted); the UI shows masked values.
 */
export interface ExportIdentification {
  taxpayerName: string
  taxpayerSin: string | null // full, in-memory only
  taxpayerDob: string | null // ISO date, in-memory only
  taxpayerAddress: string
  province: string
  maritalStatus: MaritalStatus
  spouseFirstName: string | null
  spouseSin: string | null // full, in-memory only
  spouseNetIncome: number | null
}

/**
 * The complete prepare-&-verify export. `transcriptionCards` + `nonSlipItems`
 * are the PRIMARY thing the user re-keys; `reconciliationLines` is the T1
 * line-by-line cross-check ("after entering slips, line 12000 should read $X").
 */
export interface T1Export {
  taxYear: number
  province: string
  identification: ExportIdentification
  transcriptionCards: SlipTranscriptionCard[]
  nonSlipItems: NonSlipItem[]
  /** verification-only T1 line totals (NOT the primary re-key surface). */
  reconciliationLines: T1Lines
  result: T1Result
  report: ValidationReport
  engineVersion: string
  /** sha256 of the canonical export payload (persisted; payload is not). */
  checksum: string
}

// ---------------------------------------------------------------------------
// engineVersion convention
// ---------------------------------------------------------------------------

/**
 * The compute-engine semver. Bump on any change to compute.ts math so a prepared
 * return reopened under different logic forces an explicit re-prepare.
 */
export const T1_COMPUTE_SEMVER = '1.0.0'

/**
 * engineVersion = "{computeSemver}+{rateYear}+{provHash}".
 *  - computeSemver: T1_COMPUTE_SEMVER
 *  - rateYear:      the rate table's taxYear (e.g. "2025")
 *  - provHash:      short hash of the province profile (rateVersion + jurisdiction)
 *
 * Reopening a prepared return whose recomputed string differs from the stored
 * one forces an explicit re-prepare (never a silent recompute).
 */
export function makeEngineVersion(rateYear: number, provHash: string): string {
  return `${T1_COMPUTE_SEMVER}+${rateYear}+${provHash}`
}

// Re-export the dividend kind so T1 consumers share one definition.
export type { DividendKind }
