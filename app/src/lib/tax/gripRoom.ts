import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'
import { getFiscalYearEnd, fiscalYearEndDate, type FiscalYearEnd } from '@/lib/cca/service'
import { FEDERAL_T2_2025 } from '@/lib/tax/t2/rates/federal2025'

/**
 * GRIP-room guard for eligible-dividend designation (BLOCKER 3 — the load-bearing
 * fix for the active-income-only CCPC, whose GRIP is $0).
 *
 * A CCPC may only designate a dividend ELIGIBLE to the extent it has General
 * Rate Income Pool (GRIP, ITA 89(1)). Designating more than the GRIP balance is
 * an "excessive eligible dividend designation" that triggers the ITA 185.1
 * Part III.1 penalty tax (20%, or 30% where the CRA finds it was deliberate).
 *
 * GRIP room available for a NEW eligible designation, as of a declaration date:
 *
 *   room = openingGRIP
 *        + gripFactor (0.72) × prior-year FULL-RATE taxable income (ex-SBD, ex-AII)
 *        + eligible dividends RECEIVED
 *        − eligible dividends ALREADY designated/paid this fiscal year
 *
 * `openingGRIP`, `priorYearFullRateTaxableIncome`, and `eligibleDividendsReceived`
 * are sourced (in priority order) from the prior year's prepared T2 result
 * snapshot, then the current year's `T2ContinuityBalance`, defaulting to 0 when
 * no T2 has been prepared yet (the v1 persona's normal state → room = 0). The
 * "already designated this year" subtrahend mirrors `computeT5`: it sums posted
 * journal-entry DEBITS to the configured Dividends Declared account tagged
 * `dividendEligibility = 'eligible'` within the fiscal window. This is a
 * detect-and-block guard, NOT the authoritative GRIP roll-forward (that lives in
 * the T2 engine / continuity record).
 *
 * No personal or business data is read into the computation surface — only
 * amounts and the configured GL account id.
 */

export interface GripRoomBreakdown {
  /** opening GRIP carried in (prior-year closing GRIP, or continuity opening, or 0). */
  openingGrip: number
  /** 0.72 × prior-year full-rate taxable income (the year's GRIP addition). */
  gripAddition: number
  /** prior-year full-rate (ex-SBD, ex-AII) taxable income the addition is based on. */
  priorYearFullRateTaxableIncome: number
  /** the 0.72 GRIP factor used. */
  gripFactor: number
  /** eligible dividends received (flow-through to GRIP). */
  eligibleDividendsReceived: number
  /** eligible dividends already designated/paid this fiscal year (reduces room). */
  eligibleDividendsAlreadyPaid: number
  /** room remaining for a NEW eligible designation = max(0, the algebra above). */
  roomRemaining: number
  /** the fiscal window the "already paid" figure was summed over. */
  fiscalYearStart: string // ISO
  fiscalYearEnd: string // ISO
  /** taxation year the FYE falls in. */
  taxationYear: number
  /** whether a prior prepared T2 fed the opening/full-rate figures. */
  hasPriorReturn: boolean
}

/** The shape we read off a prepared T2's `resultSnapshot.federal` (loose). */
interface FederalSnapshotLike {
  closingGrip?: unknown
  fullRateTaxableIncome?: unknown
  eligibleDividendsReceived?: unknown
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Resolve the fiscal-year window (start..end) whose FYE falls in `taxationYear`,
 * using the configured fiscal year-end (default Dec 31). Start is the day after
 * the prior FYE.
 */
function fiscalWindow(taxationYear: number, fye: FiscalYearEnd): { start: Date; end: Date } {
  const end = fiscalYearEndDate(taxationYear, fye)
  // Start = day after the previous year-end.
  const prevEnd = fiscalYearEndDate(taxationYear - 1, fye)
  const start = new Date(prevEnd.getTime() + 1)
  return { start, end }
}

/**
 * Read the prior year's prepared (or any preparing) federal snapshot, if one
 * exists, to source opening GRIP, prior-year full-rate TI, and eligible
 * dividends received. Prefers the most-recently-prepared return whose FYE is the
 * prior fiscal year-end; falls back to the latest prepared return strictly
 * before the current FYE.
 */
async function readPriorFederalSnapshot(
  currentFye: Date
): Promise<FederalSnapshotLike | null> {
  const prior = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd: { lt: currentFye }, status: { in: ['prepared', 'superseded'] } },
    orderBy: [{ fiscalYearEnd: 'desc' }, { amendmentSeq: 'desc' }, { preparedAt: 'desc' }],
    select: { resultSnapshot: true },
  })
  if (!prior?.resultSnapshot || typeof prior.resultSnapshot !== 'object') return null
  const snap = prior.resultSnapshot as Record<string, unknown>
  const federal = snap.federal
  if (!federal || typeof federal !== 'object') return null
  return federal as FederalSnapshotLike
}

/**
 * Sum eligible dividends already designated/paid in the fiscal window — posted
 * JE debits to the configured Dividends Declared account tagged
 * `dividendEligibility = 'eligible'`. Mirrors `computeT5`'s GL pull.
 */
async function sumEligiblePaid(
  dividendsDeclaredAccountId: string | null,
  start: Date,
  end: Date
): Promise<number> {
  if (!dividendsDeclaredAccountId) return 0
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: dividendsDeclaredAccountId,
      journalEntry: {
        status: 'posted',
        entryDate: { gte: start, lte: end },
        dividendEligibility: 'eligible',
      },
    },
    select: { debit: true },
  })
  let total = 0
  for (const l of lines) total += Number(l.debit || 0)
  return round2(total)
}

/**
 * Compute live GRIP room for an eligible designation as of `declaredDate`.
 * `dividendsDeclaredAccountId` is the configured account (pass the resolved id to
 * avoid a re-lookup). Pure-of-side-effects aside from the two reads.
 */
export async function computeGripRoom({
  declaredDate,
  dividendsDeclaredAccountId,
}: {
  declaredDate: Date
  dividendsDeclaredAccountId: string | null
}): Promise<GripRoomBreakdown> {
  const fye = await getFiscalYearEnd()
  const taxationYear = declaredDate.getUTCFullYear()
  const { start, end } = fiscalWindow(taxationYear, fye)

  const [priorSnap, eligibleDividendsAlreadyPaid, continuity] = await Promise.all([
    readPriorFederalSnapshot(end),
    sumEligiblePaid(dividendsDeclaredAccountId, start, end),
    prisma.t2ContinuityBalance.findUnique({ where: { fiscalYearEnd: end } }),
  ])

  const hasPriorReturn = priorSnap != null

  // Opening GRIP: prior prepared closing GRIP wins; else the current-year
  // continuity opening; else 0 (the v1 persona's normal state).
  const openingGrip = priorSnap
    ? num(priorSnap.closingGrip)
    : continuity
      ? num(continuity.openingGrip)
      : 0

  const priorYearFullRateTaxableIncome = priorSnap ? num(priorSnap.fullRateTaxableIncome) : 0
  const eligibleDividendsReceived = priorSnap ? num(priorSnap.eligibleDividendsReceived) : 0

  const gripFactor = FEDERAL_T2_2025.gripFactor
  const gripAddition = round2(gripFactor * priorYearFullRateTaxableIncome)

  const roomRemaining = Math.max(
    0,
    round2(openingGrip + gripAddition + eligibleDividendsReceived - eligibleDividendsAlreadyPaid)
  )

  return {
    openingGrip: round2(openingGrip),
    gripAddition,
    priorYearFullRateTaxableIncome: round2(priorYearFullRateTaxableIncome),
    gripFactor,
    eligibleDividendsReceived: round2(eligibleDividendsReceived),
    eligibleDividendsAlreadyPaid,
    roomRemaining,
    fiscalYearStart: start.toISOString(),
    fiscalYearEnd: end.toISOString(),
    taxationYear,
    hasPriorReturn,
  }
}
