/**
 * T1 slip pull (DB adapter) — the dual of the T5 GL pull.
 *
 * `pullT1FromSlips(taxYear, filerPartyId)` sums the filer's effective slip boxes
 * into T1 lines, scoped by `partyId` (NOT by SIN — AES-GCM uses a random IV so
 * SIN ciphertext is non-deterministic and equality-matching would pull nothing;
 * see SPEC item 5 / the gap-review adjudication). It reads OVERRIDE-aware box
 * values via the same effective-box rule as the Summary (`override[k] ?? box[k]`)
 * through `effectiveSlipsForYear`.
 *
 * It is a thin adapter: the declarative box→line mapping lives in descriptors.ts
 * (no amounts hardcoded). Derivations (design §1.3):
 *   12010 = Σ box11                   (taxable non-eligible)
 *   12000 = Σ (box11 + box25)         (total taxable dividends)
 *   40425 = Σ (box12 + box26)         (federal dividend tax credit)
 *
 * Provenance for drift: `pulledRefs[line]` records the logical `slipNumber` +
 * highest `amendmentSeq` consumed (NOT row ids alone — amendments mint new ids),
 * so recompute can detect a stale line when a slip is later amended (§1.4).
 *
 * Validation:
 *  - every consumed slip MUST be `currency === 'CAD'` (error otherwise).
 *  - company-issued slips (those carrying a GL `sourceRef`) get an arithmetic
 *    re-derivation (gross-up ×1.15/×1.38, DTC ×9.0301%/×15.0198%, tol 0.02);
 *    manually keyed external slips are authoritative (non-negativity only),
 *    matching the T5 GL-pull's own rounding so the user isn't drowned in
 *    false INTRA_SLIP warnings.
 */

import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'
import { dividendRates } from '@/lib/tax/rates'
import { effectiveSlipsForYear, type EffectiveSlipRow } from '@/lib/tax/effectiveSlips'
import {
  T1_SLIP_TYPES,
  slipLineMapsFor,
  type T1SlipType,
  type T1SlipLineMap,
} from '@/lib/tax/t1/descriptors'
import type {
  T1Lines,
  PulledRef,
  PulledRefs,
  DividendBreakdown,
  PullResult,
  ValidationIssue,
} from '@/lib/tax/t1/types'

/** Arithmetic tolerance for company-issued slip re-derivation (design §1.3). */
const REDERIVE_TOL = 0.02

/** Read an effective (override-aware) box value off a slip; undefined if absent. */
function effBox(
  boxes: Record<string, unknown> | null | undefined,
  override: Record<string, unknown> | null | undefined,
  key: string
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

/** Per-line accumulator while summing (kept separate from the public PulledRef). */
interface LineAccum {
  total: number
  slipType: T1SlipType
  slipNumbers: Set<string>
  slipIds: Set<string>
  amendmentSeq: number
}

function touch(acc: Map<string, LineAccum>, line: string, slipType: T1SlipType): LineAccum {
  let a = acc.get(line)
  if (!a) {
    a = { total: 0, slipType, slipNumbers: new Set(), slipIds: new Set(), amendmentSeq: 0 }
    acc.set(line, a)
  }
  return a
}

/**
 * Re-derive a company-issued dividend slip's taxable/DTC boxes from its actual
 * amount and assert they match the stored values within tolerance. Returns
 * INTRA_SLIP warnings (non-blocking) — the stored filed values remain the
 * source of truth; this is a drift check on the app's own arithmetic.
 */
function rederiveWarnings(
  taxYear: number,
  slipType: T1SlipType,
  slipLabel: string,
  slipId: string,
  read: (key: string) => number | undefined
): ValidationIssue[] {
  if (slipType !== 'T5' && slipType !== 'T3') return []
  const factors = dividendRates(taxYear)
  const issues: ValidationIssue[] = []

  const check = (
    actualKey: string,
    taxableKey: string,
    dtcKey: string,
    f: { grossUp: number; dtcOfTaxable: number }
  ) => {
    const actual = read(actualKey)
    const taxable = read(taxableKey)
    const dtc = read(dtcKey)
    if (actual === undefined || taxable === undefined) return
    const expTaxable = round2(actual * (1 + f.grossUp))
    if (Math.abs(expTaxable - taxable) > REDERIVE_TOL) {
      issues.push({
        level: 'warning',
        code: 'INTRA_SLIP',
        message: `${slipLabel}: taxable ${taxableKey} (${taxable}) does not match grossed-up actual (expected ${expTaxable}).`,
        slipId,
      })
    }
    if (dtc !== undefined) {
      const expDtc = round2(taxable * f.dtcOfTaxable)
      if (Math.abs(expDtc - dtc) > REDERIVE_TOL) {
        issues.push({
          level: 'warning',
          code: 'INTRA_SLIP',
          message: `${slipLabel}: DTC ${dtcKey} (${dtc}) does not match taxable × DTC rate (expected ${expDtc}).`,
          slipId,
        })
      }
    }
  }

  if (slipType === 'T5') {
    check('box10', 'box11', 'box12', factors.nonEligible)
    check('box24', 'box25', 'box26', factors.eligible)
  } else {
    // T3: eligible box49/50/51, non-eligible box23/32/39.
    check('box49', 'box50', 'box51', factors.eligible)
    check('box23', 'box32', 'box39', factors.nonEligible)
  }
  return issues
}

/**
 * Pull all of a filer's effective slips for a year into T1 lines.
 *
 * @param taxYear        the return's tax year.
 * @param filerPartyId   the TaxParty.id of the filer (= T1Return.partyId).
 */
export async function pullT1FromSlips(
  taxYear: number,
  filerPartyId: string
): Promise<PullResult> {
  const issues: ValidationIssue[] = []
  const accum = new Map<string, LineAccum>()

  // Dividend split sub-totals (drive the income-tested credit math downstream).
  let taxableEligible = 0
  let taxableNonEligible = 0
  let federalDtc = 0

  for (const type of T1_SLIP_TYPES) {
    const maps = slipLineMapsFor(type)
    if (maps.length === 0) continue

    const all = await effectiveSlipsForYear(type, taxYear)
    const slips = all.filter((s) => s.partyId === filerPartyId)
    if (slips.length === 0) continue

    // currency + sourceRef are not in EffectiveSlipRow's projection — fetch them
    // for just the consumed rows. sourceRef presence ⇒ app/GL-issued slip.
    const metaRows = await prisma.taxSlip.findMany({
      where: { id: { in: slips.map((s) => s.id) } },
      select: { id: true, currency: true, sourceRef: true },
    })
    const meta = new Map(metaRows.map((m) => [m.id, m]))

    for (const slip of slips) {
      const m = meta.get(slip.id)
      const currency = m?.currency ?? 'CAD'
      if (currency !== 'CAD') {
        issues.push({
          level: 'error',
          code: 'NON_CAD_SLIP',
          message: `${type} #${slip.slipNumber ?? slip.id} is in ${currency}; only CAD slips can be pulled into the T1.`,
          slipId: slip.id,
        })
        // Do not consume a non-CAD slip — the verify gate must block on this.
        continue
      }

      const boxes = (slip.boxes ?? {}) as Record<string, unknown>
      const override = (slip.boxesOverride ?? null) as Record<string, unknown> | null
      const read = (key: string) => effBox(boxes, override, key)

      const companyIssued = m?.sourceRef != null
      const slipLabel = `${type} #${slip.slipNumber ?? slip.id}`

      if (companyIssued) {
        issues.push(...rederiveWarnings(taxYear, type, slipLabel, slip.id, read))
      } else {
        // External/manual slip: non-negativity only.
        for (const map of maps) {
          const v = read(map.boxKey)
          if (v !== undefined && v < 0) {
            issues.push({
              level: 'warning',
              code: 'NEGATIVE_BOX',
              message: `${slipLabel}: box ${map.officialNumber} is negative (${v}).`,
              slipId: slip.id,
            })
          }
        }
      }

      for (const map of consumable(maps)) {
        const v = read(map.boxKey)
        if (v === undefined) continue

        // 'actual'-role boxes are transcription-only; they don't sum into a line.
        if (map.role === 'actual') continue

        const a = touch(accum, map.line, type)
        a.total = round2(a.total + v)
        if (slip.slipNumber) a.slipNumbers.add(slip.slipNumber)
        a.slipIds.add(slip.id)
        if (slip.amendmentSeq > a.amendmentSeq) a.amendmentSeq = slip.amendmentSeq

        switch (map.role) {
          case 'taxableEligible':
            taxableEligible = round2(taxableEligible + v)
            break
          case 'taxableNonEligible':
            taxableNonEligible = round2(taxableNonEligible + v)
            break
          case 'federalDtc':
            federalDtc = round2(federalDtc + v)
            break
        }
      }
    }
  }

  // 12000 = Σ (box11 + box25): the taxableEligible + taxableNonEligible total.
  // The descriptors map box25→12000 and box11→12010; 12000 must ALSO include the
  // non-eligible taxable (it is the grand total). Fold 12010 into 12000.
  const nonEligLine = accum.get('12010')
  if (nonEligLine && nonEligLine.total > 0) {
    const total = touch(accum, '12000', 'T5')
    total.total = round2(total.total + nonEligLine.total)
    for (const n of nonEligLine.slipNumbers) total.slipNumbers.add(n)
    for (const id of nonEligLine.slipIds) total.slipIds.add(id)
    if (nonEligLine.amendmentSeq > total.amendmentSeq) total.amendmentSeq = nonEligLine.amendmentSeq
  }

  // Materialize lines + pulledRefs.
  const lines: T1Lines = {}
  const pulledRefs: PulledRefs = {}
  for (const [line, a] of accum) {
    lines[line] = round2(a.total)
    const ref: PulledRef = {
      slipType: a.slipType,
      slipNumbers: [...a.slipNumbers].sort(),
      slipIds: [...a.slipIds].sort(),
      amendmentSeq: a.amendmentSeq,
      total: round2(a.total),
    }
    pulledRefs[line] = ref
  }

  const dividends: DividendBreakdown = {
    taxableEligible: round2(taxableEligible),
    taxableNonEligible: round2(taxableNonEligible),
    federalDtc: round2(federalDtc),
  }

  // Consistency invariants surfaced as warnings for the verify gate (§gap-fix 4).
  const l12000 = lines['12000'] ?? 0
  const l12010 = lines['12010'] ?? 0
  if (l12010 > l12000 + REDERIVE_TOL) {
    issues.push({
      level: 'error',
      code: 'DIVIDEND_SPLIT',
      message: `Line 12010 (${l12010}) exceeds line 12000 (${l12000}); the non-eligible subset cannot exceed the total.`,
      line: '12010',
    })
  }

  return { lines, pulledRefs, dividends, issues }
}

/** Drop opt-in mappings from the consumable set (capital gains / T3 / fees). */
function consumable(maps: T1SlipLineMap[]): T1SlipLineMap[] {
  return maps.filter((m) => !m.optIn)
}

export type { EffectiveSlipRow }
