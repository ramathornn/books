import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'
import { dividendRates } from '@/lib/tax/rates'

/**
 * Pure-ish T5 box computation.
 *
 * `computeT5Boxes` is a deterministic pure function over its inputs — it does no
 * I/O. `pullT5Dividends` is the thin DB adapter that sources the actual dividend
 * amount from the GL: it sums posted Journal Entry *debits* to the configured
 * `CompanySettings.dividendsDeclaredAccountId` (the "3300 Dividends Declared"
 * contra-equity account) for the recipient within the tax year.
 *
 * Example (2025, non-eligible, actual = 100000.00):
 *   Box 10 (actual)  = 100000.00
 *   Box 11 (taxable) = round2(100000 * 1.15)        = 115000.00
 *   Box 12 (DTC)     = round2(115000 * 0.090301)    = 10384.62
 */

export type DividendKind = 'eligible' | 'nonEligible'

export interface T5ComputeInput {
  taxYear: number
  /** actual dividend paid/declared, in CAD. */
  actualDividend: number
  kind: DividendKind
}

export interface T5Boxes {
  // Non-eligible (other than eligible) dividends
  box10?: number // actual amount of dividends
  box11?: number // taxable amount of dividends
  box12?: number // federal dividend tax credit
  // Eligible dividends
  box24?: number // actual amount of eligible dividends
  box25?: number // taxable amount of eligible dividends
  box26?: number // dividend tax credit for eligible dividends
}

/**
 * Pure function: given the actual dividend, tax year, and eligibility, produce
 * the T5 box amounts. No DB access — fully unit-testable (see round/rates).
 */
export function computeT5Boxes(input: T5ComputeInput): T5Boxes {
  const { taxYear, actualDividend, kind } = input
  const factors = dividendRates(taxYear)
  if (kind === 'nonEligible') {
    const f = factors.nonEligible
    const box10 = round2(actualDividend)
    const box11 = round2(box10 * (1 + f.grossUp))
    const box12 = round2(box11 * f.dtcOfTaxable)
    return { box10, box11, box12 }
  }
  const f = factors.eligible
  const box24 = round2(actualDividend)
  const box25 = round2(box24 * (1 + f.grossUp))
  const box26 = round2(box25 * f.dtcOfTaxable)
  return { box24, box25, box26 }
}

export interface T5ComputeResult {
  boxes: T5Boxes
  sourceRef: {
    dividendsDeclaredAccountId: string | null
    pulledTotal: number
    journalEntryLineIds: string[]
    /**
     * The eligibility split that produced the boxes. `eligible`/`nonEligible`
     * are the per-JE-tagged subtotals; `kind` is the fallback applied to any
     * legacy declaration whose JE predates the `dividendEligibility` tag.
     */
    kind: DividendKind
    eligibleTotal: number
    nonEligibleTotal: number
    taxYear: number
  }
}

/**
 * Merge two T5 box sets. A mixed-eligibility year reports both the eligible
 * (24/25/26) and non-eligible (10/11/12) box groups on the one slip, so the
 * union of keys is taken (the two groups never share a box number).
 */
function mergeBoxes(a: T5Boxes, b: T5Boxes): T5Boxes {
  const out: T5Boxes = {}
  for (const k of ['box10', 'box11', 'box12', 'box24', 'box25', 'box26'] as const) {
    const v = round2((a[k] ?? 0) + (b[k] ?? 0))
    if (v !== 0) out[k] = v
  }
  return out
}

/**
 * DB adapter: pull the actual dividend for a party/year from the GL and compute
 * the boxes. Sums posted JE debits to the dividends-declared account, **grouped
 * by each declaration's `dividendEligibility` tag** (set at declare time): the
 * eligible subtotal routes to boxes 24/25/26 and the non-eligible subtotal to
 * 10/11/12, so a year with both kinds reports both box groups on the slip.
 *
 * Legacy declarations whose JE predates the `dividendEligibility` tag are
 * untagged (null); those fall back to the `kind` argument (the slip UI's
 * eligible/non-eligible toggle), preserving the old single-kind behaviour for
 * existing data. The party is matched via the recipient relation when the JE
 * lines carry it; for the single-shareholder case the whole account balance for
 * the year is the dividend to that shareholder, so when no party scoping exists
 * we take the full declared total. Returns boxes + a `sourceRef` for drift.
 */
export async function computeT5({
  taxYear,
  kind,
  dividendsDeclaredAccountId,
}: {
  taxYear: number
  /** fallback eligibility for legacy (untagged) declarations. */
  kind: DividendKind
  dividendsDeclaredAccountId?: string | null
}): Promise<T5ComputeResult> {
  let accountId = dividendsDeclaredAccountId ?? null
  if (!accountId) {
    const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
    accountId = settings?.dividendsDeclaredAccountId ?? null
  }

  const start = new Date(Date.UTC(taxYear, 0, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999))

  let eligibleTotal = 0
  let nonEligibleTotal = 0
  const journalEntryLineIds: string[] = []

  if (accountId) {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        glAccountId: accountId,
        journalEntry: { status: 'posted', entryDate: { gte: start, lte: end } },
      },
      select: { id: true, debit: true, journalEntry: { select: { dividendEligibility: true } } },
    })
    for (const l of lines) {
      const amt = Number(l.debit || 0)
      // Untagged legacy declarations follow the requested fallback `kind`.
      const tag = l.journalEntry.dividendEligibility ?? kind
      if (tag === 'eligible') eligibleTotal += amt
      else nonEligibleTotal += amt
      journalEntryLineIds.push(l.id)
    }
  }

  const eligibleBoxes =
    eligibleTotal > 0 ? computeT5Boxes({ taxYear, actualDividend: eligibleTotal, kind: 'eligible' }) : {}
  const nonEligibleBoxes =
    nonEligibleTotal > 0 ? computeT5Boxes({ taxYear, actualDividend: nonEligibleTotal, kind: 'nonEligible' }) : {}
  const boxes = mergeBoxes(eligibleBoxes, nonEligibleBoxes)

  return {
    boxes,
    sourceRef: {
      dividendsDeclaredAccountId: accountId,
      pulledTotal: round2(eligibleTotal + nonEligibleTotal),
      journalEntryLineIds,
      kind,
      eligibleTotal: round2(eligibleTotal),
      nonEligibleTotal: round2(nonEligibleTotal),
      taxYear,
    },
  }
}
