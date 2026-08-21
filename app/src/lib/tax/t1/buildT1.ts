/**
 * T1 build + verify-before-prepare pipeline — `buildT1`.
 *
 * This is the T1 analogue of filing.ts's verify-before-FILE posture, adapted to
 * the "Prepare & verify" verb (the app can never NETFILE). It:
 *   1. Loads the T1Return + filer TaxParty.
 *   2. Pulls the filer's effective slips into T1 lines (pull.ts; partyId-scoped,
 *      CAD-only — SPEC item 5) and folds in any manual `linesOverride`.
 *   3. Runs the pure compute engine (compute.ts) over the EFFECTIVE lines.
 *   4. Runs the verify gate: a ValidationReport of ERRORS (block prepare) +
 *      WARNINGS (acknowledge), cloned from filing.ts's discipline.
 *   5. Regenerates the SIN-bearing per-slip transcription EXPORT IN MEMORY
 *      (export.ts) — the primary re-keying deliverable. Nothing here persists a
 *      SIN/DOB-bearing artifact; the route persists only `checksum` + `report` +
 *      `result` (the line snapshot), regenerating the export on authorized
 *      download (mirrors filing.ts).
 *
 * Returns `{ result, report, export }`. The route decides whether to flip the
 * return to `prepared` (blocked when `report.ok === false`) and what to persist.
 *
 * Reads the DB; performs NO writes. Throws only on unexpected programmer errors —
 * every expected verification failure is an issue with `report.ok === false`.
 */

import prisma from '@/lib/prisma'

import { round2 } from '@/lib/tax/round'
import { decryptSin, isValidSin, maskSin } from '@/lib/tax/sin'
import { getCompanySettings } from '@/lib/company'
import { effectiveSlipsForYear } from '@/lib/tax/effectiveSlips'
import { computeT1, type ComputeT1Context } from '@/lib/tax/t1/compute'
import { pullT1FromSlips } from '@/lib/tax/t1/pull'
import { buildT1Export } from '@/lib/tax/t1/export'
import { getRateTable, isSupportedProvince, engineVersionFor } from '@/lib/tax/t1/rates'
import { T1_SLIP_TYPES, slipLineMapsFor } from '@/lib/tax/t1/descriptors'
import { COUPLED_STATUSES } from '@/lib/tax/t1/types'
import type {
  ExportIdentification,
  MaritalStatus,
  NonSlipItem,
  PulledRefs,
  SlipTranscriptionCard,
  T1Export,
  T1Lines,
  T1Result,
  TranscriptionBox,
  ValidationIssue,
  ValidationReport,
} from '@/lib/tax/t1/types'

/** Owing threshold (CRA) above which instalment interest may apply NEXT year. */
const INSTALMENT_THRESHOLD = 3000

/** Re-key/foot tolerance shared with the pull's arithmetic checks. */
const FOOT_TOL = 0.02

/** Options the route threads in (manual line overrides + opt-in NOA limit). */
export interface BuildT1Options {
  /** manual line entries/overrides (RRSP 20800, instalments 47600, etc.). */
  linesOverride?: T1Lines | null
  /** the RRSP deduction limit from the latest NOA, for the over-limit warning. */
  noaRrspLimit?: number | null
}

export interface BuildT1Result {
  result: T1Result
  report: ValidationReport
  /** in-memory, SIN-bearing export; NEVER persisted as-is. */
  export: T1Export
}

interface LoadedReturn {
  id: string
  taxYear: number
  province: string
  partyId: string
  maritalStatus: string
  spouseFirstNameSnapshot: string | null
  spouseSinCipher: string | null
  spouseNetIncome: unknown // Prisma Decimal | null
  taxpayerSinCipher: string | null
  taxpayerNameSnapshot: string
  taxpayerAddressSnapshot: string
  taxpayerDobSnapshot: Date | null
  linesOverride: unknown
}

/** Coerce a Prisma Decimal | string | number | null to a finite number | null. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null
  const n = typeof v === 'object' && v !== null ? Number(v.toString()) : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Build + verify a T1 return for a filer/year. The heart of the verify gate.
 */
export async function buildT1(
  taxYear: number,
  filerPartyId: string,
  opts: BuildT1Options = {},
): Promise<BuildT1Result> {
  const issues: ValidationIssue[] = []

  // ---- load the return + filer party ----
  const ret = (await prisma.t1Return.findFirst({
    where: { taxYear, partyId: filerPartyId },
    orderBy: { amendmentSeq: 'desc' },
    select: {
      id: true,
      taxYear: true,
      province: true,
      partyId: true,
      maritalStatus: true,
      spouseFirstNameSnapshot: true,
      spouseSinCipher: true,
      spouseNetIncome: true,
      taxpayerSinCipher: true,
      taxpayerNameSnapshot: true,
      taxpayerAddressSnapshot: true,
      taxpayerDobSnapshot: true,
      linesOverride: true,
    },
  })) as LoadedReturn | null

  const party = await prisma.taxParty.findUnique({
    where: { id: filerPartyId },
    select: {
      firstName: true,
      lastName: true,
      sinCipher: true,
      sinLast3: true,
      dateOfBirth: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      province: true,
      postalCode: true,
      country: true,
    },
  })

  if (!party) {
    issues.push({ level: 'error', code: 'NO_FILER', message: `Filer party ${filerPartyId} not found.` })
  }

  // ---- resolve identity (return snapshot wins; fall back to the live party) ----
  const province = (ret?.province || party?.province || 'AB').toUpperCase()
  const maritalStatus = (ret?.maritalStatus || 'single') as MaritalStatus
  const coupled = COUPLED_STATUSES.includes(maritalStatus)
  const dob = ret?.taxpayerDobSnapshot ?? party?.dateOfBirth ?? null
  const spouseNetIncome = toNum(ret?.spouseNetIncome)
  const taxpayerName =
    (ret?.taxpayerNameSnapshot || '').trim() ||
    [party?.firstName, party?.lastName].filter(Boolean).join(' ').trim()
  const taxpayerAddress =
    (ret?.taxpayerAddressSnapshot || '').trim() || partyAddress(party)

  // ---- province profile gate (NEVER inherited from CompanySettings) ----
  if (!isSupportedProvince(province)) {
    issues.push({
      level: 'error',
      code: 'PROVINCE_UNSUPPORTED',
      message: `Province ${province} is not supported in v1 (it files a separate provincial return). Only Alberta (and other common-law provinces) are supported.`,
    })
  }
  const rateTable = getRateTable(taxYear, province)

  // ---- rate-year guard ----
  if (rateTable.taxYear !== taxYear) {
    issues.push({
      level: 'warning',
      code: 'RATE_YEAR_FALLBACK',
      message: `No rate table for ${taxYear}; using ${rateTable.taxYear} figures. Verify the brackets/credits before relying on this.`,
    })
  }

  // ---- identity errors ----
  if (!taxpayerName) {
    issues.push({ level: 'error', code: 'NO_NAME', message: 'Taxpayer name is required.' })
  }

  // SIN: present + Luhn-valid (decrypt in memory; never persisted).
  let taxpayerSin: string | null = null
  if (!party?.sinCipher) {
    issues.push({ level: 'error', code: 'NO_SIN', message: 'Taxpayer SIN is required.' })
  } else {
    try {
      taxpayerSin = decryptSin(party.sinCipher)
      if (!isValidSin(taxpayerSin)) {
        issues.push({ level: 'error', code: 'SIN_LUHN', message: 'Taxpayer SIN fails the Luhn checksum.' })
      }
    } catch {
      issues.push({ level: 'error', code: 'SIN_DECRYPT', message: 'Taxpayer SIN could not be decrypted (key/version mismatch).' })
    }
  }

  // DOB present (hard error — required on the return; the $0 age amount is a
  // separate WARNING below).
  if (!dob) {
    issues.push({ level: 'error', code: 'NO_DOB', message: 'Taxpayer date of birth is required.' })
  }

  // Marital status must be a known category.
  const KNOWN_MARITAL: MaritalStatus[] = ['single', 'married', 'commonLaw', 'separated', 'divorced', 'widowed']
  if (!KNOWN_MARITAL.includes(maritalStatus)) {
    issues.push({ level: 'error', code: 'MARITAL_UNKNOWN', message: `Unknown marital status "${maritalStatus}".` })
  }

  // ---- spouse gate (when coupled) ----
  let spouseSin: string | null = null
  if (coupled) {
    if (spouseNetIncome === null) {
      issues.push({ level: 'error', code: 'SPOUSE_NET_INCOME', message: 'Spouse net income (her line 23600) is required when married/common-law.' })
    } else if (spouseNetIncome < 0) {
      issues.push({ level: 'error', code: 'SPOUSE_NET_INCOME_NEG', message: 'Spouse net income cannot be negative.' })
    }
    if (!ret?.spouseFirstNameSnapshot?.trim()) {
      issues.push({ level: 'error', code: 'SPOUSE_NAME', message: 'Spouse first name is required when married/common-law.' })
    }
    if (!ret?.spouseSinCipher) {
      issues.push({ level: 'error', code: 'SPOUSE_SIN', message: 'Spouse SIN is required when married/common-law.' })
    } else {
      try {
        spouseSin = decryptSin(ret.spouseSinCipher)
        if (!isValidSin(spouseSin)) {
          issues.push({ level: 'error', code: 'SPOUSE_SIN_LUHN', message: 'Spouse SIN fails the Luhn checksum.' })
        }
      } catch {
        issues.push({ level: 'error', code: 'SPOUSE_SIN_DECRYPT', message: 'Spouse SIN could not be decrypted (key/version mismatch).' })
      }
    }
  }

  // ---- pull slips (CAD-only, partyId-scoped) ----
  const pull = await pullT1FromSlips(taxYear, filerPartyId)
  issues.push(...pull.issues)

  // ---- merge manual overrides over the pulled lines ----
  const override: T1Lines = {
    ...toLineMap(ret?.linesOverride),
    ...(opts.linesOverride ?? {}),
  }
  const effectiveLines: T1Lines = { ...pull.lines, ...override }

  // ---- compute ----
  const ctx: ComputeT1Context = {
    maritalStatus,
    spouseNetIncome,
    dateOfBirth: dob,
    dividends: pull.dividends,
  }
  const result = computeT1(effectiveLines, rateTable, ctx)

  // ---- arithmetic-integrity checks on the computed result ----
  issues.push(...arithmeticChecks(result, rateTable.federal.creditRate))

  // ---- drift check: re-pull seq vs nothing-stored (fresh build) — surfaced as
  // an error only when a stored amendmentSeq is now stale. On a fresh build the
  // pulled refs ARE the current truth; the route compares against the stored
  // pulledRefs and re-runs buildT1 when they differ, so drift never silently
  // survives. Here we only flag an INTERNAL inconsistency (12010 > 12000),
  // already emitted by the pull.

  // ---- engineVersion consistency (registry sha256 hash vs compute output) ----
  const expectedEngine = engineVersionFor(taxYear, province)
  if (result.engineVersion !== expectedEngine) {
    // Non-blocking: compute.ts derives the provHash from rateVersion, the
    // registry from sha256(rateVersion:province). The route persists the
    // registry string; flag a mismatch so a logic/rate change forces re-prepare.
    issues.push({
      level: 'warning',
      code: 'ENGINE_VERSION_SKEW',
      message: `Computed engine version (${result.engineVersion}) differs from the registry version (${expectedEngine}); re-prepare to refresh.`,
    })
  }

  // ---- WARNINGS ----
  // DOB present but age amount $0 (working-age owner) — acknowledge, not block.
  const ageAmountFed = result.lines['30100'] ?? 0
  if (dob && ageAmountFed === 0) {
    issues.push({
      level: 'warning',
      code: 'AGE_AMOUNT_ZERO',
      message: 'Age amount is $0 (filer is under 65 / income-tested out). Confirm the date of birth is correct.',
    })
  }

  // Owing > $3,000 with no instalments — instalment-interest heads-up for NEXT
  // year (NOT a prompt to back-fill 47600). SPEC item 8.
  const instalments = result.lines['47600'] ?? 0
  if (result.balanceOwing > INSTALMENT_THRESHOLD && instalments === 0) {
    issues.push({
      level: 'warning',
      code: 'INSTALMENT_HEADS_UP',
      message: `Balance owing (${money(result.balanceOwing)}) exceeds $${INSTALMENT_THRESHOLD.toLocaleString()}. CRA may require instalments NEXT year. Do NOT back-fill line 47600 — monthly payments against a PRIOR-year balance or a CRA payment arrangement do not belong here.`,
      line: '47600',
    })
  }

  // RRSP claimed over the NOA limit entered.
  const rrsp = result.lines['20800'] ?? 0
  if (opts.noaRrspLimit != null && rrsp > opts.noaRrspLimit + FOOT_TOL) {
    issues.push({
      level: 'warning',
      code: 'RRSP_OVER_LIMIT',
      message: `RRSP deduction claimed (${money(rrsp)}) exceeds the NOA limit entered (${money(opts.noaRrspLimit)}).`,
      line: '20800',
    })
  }

  // ---- build the in-memory export (SIN-bearing) ----
  const ok = issues.every((i) => i.level !== 'error')
  const report: ValidationReport = {
    ok,
    checkedAt: new Date().toISOString(),
    taxYear,
    province,
    issues,
  }

  const cards = await buildTranscriptionCards(taxYear, filerPartyId)
  const nonSlip = buildNonSlipItems(result, override, {
    spouseFirstName: ret?.spouseFirstNameSnapshot ?? null,
    spouseSinMasked: spouseSin ? maskSin(spouseSin) : null,
    spouseNetIncome,
    noaRrspLimit: opts.noaRrspLimit ?? null,
  })

  const identification: ExportIdentification = {
    taxpayerName,
    taxpayerSin, // full, in-memory only
    taxpayerDob: dob ? dob.toISOString().slice(0, 10) : null,
    taxpayerAddress,
    province,
    maritalStatus,
    spouseFirstName: ret?.spouseFirstNameSnapshot ?? null,
    spouseSin, // full, in-memory only
    spouseNetIncome,
  }

  const export_ = buildT1Export(result, identification, cards, nonSlip, report)

  return { result, report, export: export_ }
}

// ---------------------------------------------------------------------------
// Verify-gate sub-checks
// ---------------------------------------------------------------------------

/**
 * Arithmetic-integrity errors over the computed result: net income ≥ 0, the
 * federal NRTC rate is the live 14.5%, the per-jurisdiction clamps held (no
 * excess credit became a refund), and 43500 / 48400 / 48500 foot consistently
 * (including line 47600). These guard against a corrupted override or a logic
 * regression — they should never fire on a clean compute.
 */
function arithmeticChecks(result: T1Result, fedCreditRate: number): ValidationIssue[] {
  const out: ValidationIssue[] = []

  if (result.netIncome < 0) {
    out.push({ level: 'error', code: 'NET_INCOME_NEG', message: `Net income (23600) is negative (${money(result.netIncome)}).`, line: '23600' })
  }

  // Federal NRTC valuation rate must be the live 14.5%.
  if (Math.abs(fedCreditRate - 0.145) > 1e-9) {
    out.push({ level: 'error', code: 'FED_RATE', message: `Federal credit rate is ${fedCreditRate}, expected 0.145.` })
  }

  // Per-jurisdiction clamp: net tax can never be below $0.
  if (result.federal.netTax < 0) {
    out.push({ level: 'error', code: 'CLAMP_FED', message: `Federal net tax (42000) is negative — clamp failed.`, line: '42000' })
  }
  if (result.provincial.netTax < 0) {
    out.push({ level: 'error', code: 'CLAMP_AB', message: `Alberta net tax (42800) is negative — clamp failed.`, line: '42800' })
  }

  // 43500 = 42000 + 42800.
  const expectedPayable = round2(result.federal.netTax + result.provincial.netTax)
  if (Math.abs(result.totalPayable - expectedPayable) > FOOT_TOL) {
    out.push({ level: 'error', code: 'PAYABLE_FOOT', message: `Line 43500 (${money(result.totalPayable)}) ≠ 42000 + 42800 (${money(expectedPayable)}).`, line: '43500' })
  }

  // 48400 / 48500: payable − (withholding 43700 + instalments 47600) → one of
  // refund/owing is set, the other $0, and they foot.
  const withholding = result.lines['43700'] ?? 0
  const instalments = result.lines['47600'] ?? 0
  const net = round2(result.totalPayable - withholding - instalments)
  const expectedRefund = net < 0 ? round2(-net) : 0
  const expectedOwing = net > 0 ? net : 0
  if (Math.abs(result.refund - expectedRefund) > FOOT_TOL || Math.abs(result.balanceOwing - expectedOwing) > FOOT_TOL) {
    out.push({
      level: 'error',
      code: 'SUMMARY_FOOT',
      message: `Refund/owing (48400/48500) do not foot: payable ${money(result.totalPayable)} − withholding ${money(withholding)} − instalments ${money(instalments)} = ${money(net)}.`,
      line: '48500',
    })
  }
  if (result.refund > FOOT_TOL && result.balanceOwing > FOOT_TOL) {
    out.push({ level: 'error', code: 'REFUND_AND_OWING', message: 'Both a refund (48400) and a balance owing (48500) are set — exactly one must be non-zero.' })
  }

  return out
}

// ---------------------------------------------------------------------------
// Export assembly helpers
// ---------------------------------------------------------------------------

/**
 * Build one transcription card per EFFECTIVE slip the filer owns (T5/T4A/T3),
 * with the CRA box numbers + amounts exactly as they appear on the slip — the
 * PRIMARY re-keying surface. Reads the same effective (override-aware) box
 * values the pull uses; issuer label is the company legal name.
 */
async function buildTranscriptionCards(
  taxYear: number,
  filerPartyId: string,
): Promise<SlipTranscriptionCard[]> {
  const company = await getCompanySettings()
  const issuerLabel = (company.legalName || company.name || '').trim() || 'Issuer'
  const cards: SlipTranscriptionCard[] = []

  for (const type of T1_SLIP_TYPES) {
    const maps = slipLineMapsFor(type)
    if (maps.length === 0) continue

    const all = await effectiveSlipsForYear(type, taxYear)
    const slips = all.filter((s) => s.partyId === filerPartyId)
    if (slips.length === 0) continue

    for (const slip of slips) {
      const boxes = (slip.boxes ?? {}) as Record<string, unknown>
      const overrideBoxes = (slip.boxesOverride ?? null) as Record<string, unknown> | null

      const transcriptionBoxes: TranscriptionBox[] = []
      for (const map of maps) {
        const v = effBox(boxes, overrideBoxes, map.boxKey)
        if (v === undefined) continue
        transcriptionBoxes.push({
          boxNumber: map.officialNumber,
          label: map.label,
          amount: round2(v),
        })
      }
      if (transcriptionBoxes.length === 0) continue

      cards.push({
        slipType: type,
        issuerLabel,
        slipNumber: slip.slipNumber ?? null,
        boxes: transcriptionBoxes,
      })
    }
  }

  return cards
}

interface SpouseInfo {
  spouseFirstName: string | null
  spouseSinMasked: string | null
  spouseNetIncome: number | null
  noaRrspLimit: number | null
}

/**
 * Build the non-slip items the owner enters by hand: RRSP from the NOA,
 * instalments paid, taxable capital gains (→ Schedule 3), and the spouse
 * identification (first name + masked SIN + her net income). These are surfaced
 * even at $0 when they materially shape the return (RRSP/instalments) so the
 * owner is reminded to confirm them; capital gains only when present.
 */
function buildNonSlipItems(
  result: T1Result,
  override: T1Lines,
  spouse: SpouseInfo,
): NonSlipItem[] {
  const items: NonSlipItem[] = []

  const rrsp = result.lines['20800'] ?? 0
  items.push({
    key: 'rrsp',
    label: 'RRSP deduction',
    line: '20800',
    amount: round2(rrsp),
    help: spouse.noaRrspLimit != null
      ? `From your latest NOA (limit ${money(spouse.noaRrspLimit)}).`
      : 'From your latest Notice of Assessment.',
  })

  const instalments = result.lines['47600'] ?? 0
  items.push({
    key: 'instalments',
    label: 'Instalments paid (current tax year)',
    line: '47600',
    amount: round2(instalments),
    help: 'Only CURRENT-year instalments. Payments against a prior-year balance or a CRA payment arrangement do NOT go here.',
  })

  // Capital gains → Schedule 3 (opt-in; only when present).
  const capGains = result.lines['12700'] ?? override['12700'] ?? 0
  if (capGains > 0) {
    items.push({
      key: 'capitalGains',
      label: 'Taxable capital gains (Schedule 3)',
      line: '12700',
      amount: round2(capGains),
      help: 'Enter the underlying dispositions on Schedule 3; this is the taxable (50%) amount.',
    })
  }

  // Spouse identification jacket (no SIN persisted; masked here for the printable
  // surface — the full SIN lives only in identification, in memory).
  if (spouse.spouseFirstName || spouse.spouseSinMasked || spouse.spouseNetIncome !== null) {
    items.push({
      key: 'spouseNetIncome',
      label: `Spouse net income${spouse.spouseFirstName ? ` (${spouse.spouseFirstName})` : ''}`,
      line: '23600s',
      amount: round2(spouse.spouseNetIncome ?? 0),
      help: spouse.spouseSinMasked
        ? `Spouse SIN ${spouse.spouseSinMasked}. Enter her line 23600 on your return's spouse section.`
        : "Enter her line 23600 on your return's spouse section.",
    })
  }

  return items
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Read an effective (override-aware) box value off a slip; undefined if absent. */
function effBox(
  boxes: Record<string, unknown> | null | undefined,
  override: Record<string, unknown> | null | undefined,
  key: string,
): number | undefined {
  const o = override?.[key]
  if (o !== null && o !== undefined) {
    const n = asNum(o)
    if (n !== undefined) return n
  }
  return asNum(boxes?.[key])
}

function asNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return Number.isFinite(n) ? n : undefined
}

/** Coerce a stored JSON value into a numeric line map (string key → number). */
function toLineMap(v: unknown): T1Lines {
  if (!v || typeof v !== 'object') return {}
  const out: T1Lines = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = asNum(raw)
    if (n !== undefined) out[k] = n
  }
  return out
}

/** Single-line address from a TaxParty (mirrors the slip recipient snapshot). */
function partyAddress(p: {
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
} | null): string {
  if (!p) return ''
  const parts = [
    p.addressLine1,
    p.addressLine2,
    [p.city, p.province].filter(Boolean).join(', '),
    p.postalCode,
    p.country && p.country !== 'CA' ? p.country : '',
  ]
  return parts.filter((s) => s && s.trim()).join(', ')
}

/** 2-dp money string for issue messages. */
function money(n: number): string {
  return `$${round2(n).toFixed(2)}`
}

export type { PulledRefs }
