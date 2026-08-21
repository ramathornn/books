import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import { effectiveSlipsForYear } from '@/lib/tax/effectiveSlips'
import { round2 } from '@/lib/tax/round'
import { maskSin } from '@/lib/tax/sin'
import { T5_BOXES } from '@/lib/tax/descriptors/t5'
import { T4A_BOXES } from '@/lib/tax/descriptors/t4a'

/**
 * Live tax-slip Summary aggregation (T5 SUM / T4A SUM).
 *
 * This is the SINGLE source of truth for the on-screen Summary pages, computed
 * fresh from `effectiveSlipsForYear` on every render (design finding #5). The
 * stored `TaxSlipSummary` row is ONLY an as-filed snapshot, written at file
 * time by the file/[year] flow — it is never read as the live total here.
 *
 * The same footing used by `buildFilingExport` is reused (box keys come from the
 * descriptor, effective value = boxesOverride[k] ?? boxes[k]), so the Summary
 * page and the filing can never diverge.
 */

export type SlipType = 'T5' | 'T4A'

function descriptorFor(type: SlipType) {
  return type === 'T5' ? T5_BOXES : T4A_BOXES
}

function asNum(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Effective box value for a slip: override wins, else the computed box. */
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

export interface SummarySlipRow {
  id: string
  slipNumber: string | null
  status: string
  recipientName: string
  recipientIdMasked: string
  /** Effective box values, keyed by descriptor box key. */
  boxes: Record<string, number>
}

export interface LiveSummary {
  type: SlipType
  taxYear: number
  filer: { legalName: string; bnRz: string; address: string }
  /** Per-box footed totals across the effective slips. */
  totals: Record<string, number>
  totalRecipients: number
  rows: SummarySlipRow[]
  /** Whether any of the slips in the set is still a draft (blocks filing). */
  hasDraft: boolean
}

/**
 * Build the live Summary for a type/year directly from the effective slips.
 * Recipient ids are masked (never plaintext SIN). Box totals are footed with the
 * same `round2` rule as the filing pipeline.
 */
export async function buildLiveSummary(type: SlipType, taxYear: number): Promise<LiveSummary> {
  const company = await getCompanySettings()
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })

  const effective = await effectiveSlipsForYear(type, taxYear)

  // Pull the snapshot fields we display per slip (masking + report status).
  const full = await prisma.taxSlip.findMany({
    where: { id: { in: effective.map((s) => s.id) } },
    select: {
      id: true,
      slipNumber: true,
      status: true,
      recipientNameSnapshot: true,
      recipientSinCipher: true,
      recipientBnSnapshot: true,
      boxes: true,
      boxesOverride: true,
    },
  })
  const byId = new Map(full.map((f) => [f.id, f]))

  const descriptors = descriptorFor(type)
  const totals: Record<string, number> = {}
  for (const d of descriptors) totals[d.key] = 0

  const rows: SummarySlipRow[] = []
  for (const e of effective) {
    const f = byId.get(e.id)
    if (!f) continue
    const boxes = (f.boxes ?? {}) as Record<string, unknown>
    const override = (f.boxesOverride ?? null) as Record<string, unknown> | null

    const rowBoxes: Record<string, number> = {}
    for (const d of descriptors) {
      const v = effBox(boxes, override, d.key)
      if (v !== undefined) {
        rowBoxes[d.key] = v
        totals[d.key] += v
      }
    }

    // Masked id: prefer the BN (already non-secret) else the masked SIN last-3.
    let masked = ''
    if (f.recipientBnSnapshot && f.recipientBnSnapshot.trim()) {
      masked = f.recipientBnSnapshot.trim()
    } else if (f.recipientSinCipher) {
      // We only persist last-3 via the party; the slip cipher is decrypt-gated.
      // Display a generic SIN mask without decrypting.
      masked = maskSin('000000000').replace('000', '•••')
    }

    rows.push({
      id: f.id,
      slipNumber: f.slipNumber,
      status: f.status,
      recipientName: f.recipientNameSnapshot,
      recipientIdMasked: masked,
      boxes: rowBoxes,
    })
  }

  for (const d of descriptors) totals[d.key] = round2(totals[d.key])

  const businessNumber = settings?.businessNumber?.trim() || ''
  const rzAccount = settings?.rzAccountInfoReturns?.trim() || ''

  rows.sort((a, b) => (a.slipNumber || '').localeCompare(b.slipNumber || '') || a.recipientName.localeCompare(b.recipientName))

  return {
    type,
    taxYear,
    filer: {
      legalName: (company.legalName || company.name || '').trim(),
      bnRz: `${businessNumber} ${rzAccount}`.trim(),
      address: company.addressSingleLine || '',
    },
    totals,
    totalRecipients: rows.length,
    rows,
    hasDraft: rows.some((r) => r.status === 'draft'),
  }
}

export interface SummaryDivergence {
  /** A filed snapshot exists for this year. */
  filed: boolean
  filedAt: string | null
  craSubmissionRef: string | null
  /** Live totals differ from the last filed snapshot (an amendment is pending). */
  diverged: boolean
  /** Per-box deltas (live − snapshot) for any box that moved. */
  deltas: Record<string, number>
}

/**
 * Compare the live totals against the stored as-filed snapshot for the year.
 * Drives the "recompute / amendment pending" banner on the Summary page.
 */
export async function summaryDivergence(
  type: SlipType,
  taxYear: number,
  liveTotals: Record<string, number>
): Promise<SummaryDivergence> {
  const snap = await prisma.taxSlipSummary.findUnique({
    where: { type_taxYear: { type, taxYear } },
  })
  if (!snap) {
    return { filed: false, filedAt: null, craSubmissionRef: null, diverged: false, deltas: {} }
  }
  const snapTotals = (snap.totals ?? {}) as Record<string, unknown>
  const deltas: Record<string, number> = {}
  let diverged = false
  const keys = new Set([...Object.keys(liveTotals), ...Object.keys(snapTotals)])
  for (const k of keys) {
    const live = asNum(liveTotals[k]) ?? 0
    const snapped = asNum(snapTotals[k]) ?? 0
    const delta = round2(live - snapped)
    if (Math.abs(delta) > 0.005) {
      deltas[k] = delta
      diverged = true
    }
  }
  return {
    filed: true,
    filedAt: snap.filedAt ? snap.filedAt.toISOString() : null,
    craSubmissionRef: snap.craSubmissionRef ?? null,
    diverged,
    deltas,
  }
}

export interface YearComparisonRow {
  taxYear: number
  totalRecipients: number
  totals: Record<string, number>
  isCurrent: boolean
}

/**
 * Year-over-year comparison for the Summary page: live totals for the selected
 * year plus the prior `lookback` years, each computed from the effective slips.
 * Returns most-recent first.
 */
export async function yearOverYear(
  type: SlipType,
  taxYear: number,
  lookback = 2
): Promise<YearComparisonRow[]> {
  const years: number[] = []
  for (let y = taxYear; y > taxYear - 1 - lookback; y--) years.push(y)

  const out: YearComparisonRow[] = []
  for (const y of years) {
    const summary = await buildLiveSummary(type, y)
    out.push({
      taxYear: y,
      totalRecipients: summary.totalRecipients,
      totals: summary.totals,
      isCurrent: y === taxYear,
    })
  }
  return out
}

/** Available tax years that have at least one slip of this type (desc). */
export async function availableYears(type: SlipType): Promise<number[]> {
  const rows = await prisma.taxSlip.findMany({
    where: { type },
    select: { taxYear: true },
    distinct: ['taxYear'],
    orderBy: { taxYear: 'desc' },
  })
  return rows.map((r) => r.taxYear)
}
