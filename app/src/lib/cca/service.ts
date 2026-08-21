import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { computeCca } from '@/lib/tax/compute/cca'
import { round2 } from '@/lib/tax/round'
import { getPeriodLock } from '@/lib/periodLock'

/**
 * CCA service — the lock-aware schedule engine shared by every /api/cca/* route.
 *
 * Responsibilities (design §4 Phase 6):
 *  - resolve the company fiscal year-end (CCA JE entryDate, default Dec 31).
 *  - determine which tax years are LOCKED (period lock / FiscalYearClose) vs OPEN.
 *  - recompute the per-class declining-balance schedule rolling each year's
 *    closingUcc into the next year's openingUcc — but only for OPEN years. A
 *    locked year's stored opening/closing UCC and its `filed*` snapshot are
 *    NEVER rewritten by recompute; prior-year corrections surface as an
 *    `isCatchUp` row booked in the FIRST OPEN year.
 *
 * Nothing here posts a JE — that is the route layer's job. This module is the
 * single source of truth for "what should each year's numbers be" so the grid,
 * the editor preview, and the post path all agree.
 */

const D = (v: Prisma.Decimal | number | string | null | undefined): number =>
  v == null ? 0 : Number(v)

export interface FiscalYearEnd {
  month: number // 1-12
  day: number
}

/** Resolve the configured fiscal year-end (default Dec 31). */
export async function getFiscalYearEnd(): Promise<FiscalYearEnd> {
  const settings = await prisma.companySettings.findUnique({
    where: { id: 'singleton' },
    select: { fiscalYearEndMonth: true, fiscalYearEndDay: true },
  })
  const month = settings?.fiscalYearEndMonth ?? 12
  const day = settings?.fiscalYearEndDay ?? 31
  return { month, day }
}

/** The JE entryDate for a CCA claim in `taxYear` = that year's fiscal year-end. */
export function fiscalYearEndDate(taxYear: number, fye: FiscalYearEnd): Date {
  // Month is 1-based in config; JS Date months are 0-based.
  return new Date(taxYear, fye.month - 1, fye.day, 23, 59, 59, 999)
}

/**
 * Decide whether `taxYear` is locked. A year is locked if EITHER a
 * FiscalYearClose row exists for it OR the period lock covers that year's
 * fiscal year-end date.
 */
export async function lockedYearSet(fye: FiscalYearEnd): Promise<(taxYear: number) => boolean> {
  const [lock, closes] = await Promise.all([
    getPeriodLock(),
    prisma.fiscalYearClose.findMany({ select: { fiscalYear: true } }),
  ])
  const closedYears = new Set(closes.map((c) => c.fiscalYear))
  const lockedThrough = lock.lockedThrough?.getTime() ?? null
  return (taxYear: number): boolean => {
    if (closedYears.has(taxYear)) return true
    if (lockedThrough != null) {
      const yearEnd = fiscalYearEndDate(taxYear, fye).getTime()
      if (yearEnd <= lockedThrough) return true
    }
    return false
  }
}

export interface ClassRow {
  id: string
  classNumber: string
  description: string
  rate: number
  halfYearRuleApplies: boolean
  accIiEligible: boolean
  immediateExpensingEligible: boolean
  expenseAccountId: string | null
  accumDepAccountId: string | null
  assetAccountId: string | null
  isArchived: boolean
}

export interface ComputedYear {
  taxYear: number
  classId: string
  classNumber: string
  locked: boolean
  /** there is a stored row for this (class,year). */
  persistedId: string | null
  status: string
  isSeed: boolean
  isCatchUp: boolean
  catchUpForYear: number | null
  isOverridden: boolean
  journalEntryId: string | null
  postedAt: string | null
  // numbers (computed for open years; as-stored for locked years)
  openingUcc: number
  additions: number
  dispositions: number
  halfYearAdjustment: number
  accIiAddition: number
  ccaRate: number
  ccaBase: number
  ccaMax: number
  ccaClaimed: number
  closingUcc: number
  method: string
  recapture: boolean
  terminalLossPossible: boolean
  // as-filed snapshot (locked years only)
  filedOpeningUcc: number | null
  filedCcaClaimed: number | null
  filedClosingUcc: number | null
}

export interface ClassSchedule {
  class: ClassRow
  years: ComputedYear[]
}

interface StoredEntry {
  id: string
  taxYear: number
  openingUcc: Prisma.Decimal
  additions: Prisma.Decimal
  dispositions: Prisma.Decimal
  halfYearAdjustment: Prisma.Decimal
  accIiAddition: Prisma.Decimal
  ccaRate: Prisma.Decimal
  ccaBase: Prisma.Decimal
  ccaMax: Prisma.Decimal
  ccaClaimed: Prisma.Decimal
  closingUcc: Prisma.Decimal
  method: string
  status: string
  isSeed: boolean
  isCatchUp: boolean
  catchUpForYear: number | null
  isOverridden: boolean
  overrides: Prisma.JsonValue
  filedOpeningUcc: Prisma.Decimal | null
  filedCcaClaimed: Prisma.Decimal | null
  filedClosingUcc: Prisma.Decimal | null
  journalEntryId: string | null
  postedAt: Date | null
}

function toClassRow(c: {
  id: string
  classNumber: string
  description: string
  rate: Prisma.Decimal
  halfYearRuleApplies: boolean
  accIiEligible: boolean
  immediateExpensingEligible: boolean
  expenseAccountId: string | null
  accumDepAccountId: string | null
  assetAccountId: string | null
  isArchived: boolean
}): ClassRow {
  return {
    id: c.id,
    classNumber: c.classNumber,
    description: c.description,
    rate: D(c.rate),
    halfYearRuleApplies: c.halfYearRuleApplies,
    accIiEligible: c.accIiEligible,
    immediateExpensingEligible: c.immediateExpensingEligible,
    expenseAccountId: c.expenseAccountId,
    accumDepAccountId: c.accumDepAccountId,
    assetAccountId: c.assetAccountId,
    isArchived: c.isArchived,
  }
}

/**
 * Build the full year-by-year schedule for one class.
 *
 * Rolls closing→opening forward through OPEN years. For each year:
 *  - if a stored row exists AND the year is LOCKED, the stored row is returned
 *    verbatim (its numbers and `filed*` snapshot are authoritative; recompute
 *    does not touch it). Its closingUcc seeds the next year's opening.
 *  - if the year is OPEN, additions/dispositions come from the stored row (if
 *    any — user-entered) or default to 0, and CCA is recomputed from the rolled
 *    opening UCC. Overrides on the stored row win where present.
 *
 * `catchUp` carries a prior-year correction (the delta between what a locked
 * year's opening *would* be under recompute and what was actually filed) into
 * the first open year as an additional opening-UCC adjustment, exposed as an
 * `isCatchUp` synthetic line.
 */
export async function buildClassSchedule(
  classId: string,
  opts?: { throughYear?: number },
): Promise<ClassSchedule | null> {
  const cls = await prisma.ccaClass.findUnique({ where: { id: classId } })
  if (!cls) return null
  const classRow = toClassRow(cls)
  const fye = await getFiscalYearEnd()
  const isLocked = await lockedYearSet(fye)

  const stored = (await prisma.ccaScheduleEntry.findMany({
    where: { classId },
    orderBy: { taxYear: 'asc' },
    select: {
      id: true,
      taxYear: true,
      openingUcc: true,
      additions: true,
      dispositions: true,
      halfYearAdjustment: true,
      accIiAddition: true,
      ccaRate: true,
      ccaBase: true,
      ccaMax: true,
      ccaClaimed: true,
      closingUcc: true,
      method: true,
      status: true,
      isSeed: true,
      isCatchUp: true,
      catchUpForYear: true,
      isOverridden: true,
      overrides: true,
      filedOpeningUcc: true,
      filedCcaClaimed: true,
      filedClosingUcc: true,
      journalEntryId: true,
      postedAt: true,
    },
  })) as StoredEntry[]

  if (stored.length === 0) {
    return { class: classRow, years: [] }
  }

  const byYear = new Map<number, StoredEntry>()
  for (const s of stored) byYear.set(s.taxYear, s)

  const firstYear = stored[0].taxYear
  const lastStoredYear = stored[stored.length - 1].taxYear
  const lastYear = Math.max(lastStoredYear, opts?.throughYear ?? lastStoredYear)

  const years: ComputedYear[] = []
  let rollingOpening = D(stored[0].openingUcc)
  // Accumulated prior-year correction waiting to be booked in the first open year.
  let pendingCatchUp = 0
  let firstOpenYearSeen = false

  for (let y = firstYear; y <= lastYear; y++) {
    const s = byYear.get(y) ?? null
    const locked = isLocked(y)

    if (locked && s) {
      // Authoritative stored locked row — do NOT recompute. Track the divergence
      // between the rolled opening and the filed/stored opening so it can be
      // caught up in the first open year.
      const storedOpening = D(s.openingUcc)
      pendingCatchUp = round2(pendingCatchUp + (rollingOpening - storedOpening))
      years.push(storedToComputed(classRow, s, y, true))
      rollingOpening = D(s.closingUcc)
      continue
    }

    // OPEN year. Pick up user-entered additions/dispositions from a stored row if
    // present; otherwise zero. Apply a one-time catch-up adjustment to opening in
    // the first open year.
    const overrides = (s?.overrides as Record<string, number> | null) ?? null
    const additions = overrides?.additions ?? D(s?.additions)
    const dispositions = overrides?.dispositions ?? D(s?.dispositions)

    let openingForYear = rollingOpening
    let catchUpForThisYear = 0
    if (!firstOpenYearSeen) {
      firstOpenYearSeen = true
      if (Math.abs(pendingCatchUp) >= 0.005) {
        catchUpForThisYear = pendingCatchUp
        openingForYear = round2(openingForYear - pendingCatchUp) // remove the divergence: use the filed-forward opening
        pendingCatchUp = 0
      }
    }

    const result = computeCca({
      taxYear: y,
      classNumber: classRow.classNumber,
      rate: overrides?.ccaRate ?? classRow.rate,
      openingUcc: openingForYear,
      additions,
      dispositions,
      halfYearRuleApplies: classRow.halfYearRuleApplies,
      accIiEligible: classRow.accIiEligible,
    })

    years.push({
      taxYear: y,
      classId,
      classNumber: classRow.classNumber,
      locked: false,
      persistedId: s?.id ?? null,
      status: s?.status ?? 'draft',
      isSeed: s?.isSeed ?? false,
      isCatchUp: catchUpForThisYear !== 0,
      catchUpForYear: catchUpForThisYear !== 0 ? firstYear : (s?.catchUpForYear ?? null),
      isOverridden: s?.isOverridden ?? false,
      journalEntryId: s?.journalEntryId ?? null,
      postedAt: s?.postedAt ? s.postedAt.toISOString() : null,
      openingUcc: result.openingUcc,
      additions: result.additions,
      dispositions: result.dispositions,
      halfYearAdjustment: result.halfYearAdjustment,
      accIiAddition: result.accIiAddition,
      ccaRate: result.ccaRate,
      ccaBase: result.ccaBase,
      ccaMax: result.ccaMax,
      ccaClaimed: result.ccaClaimed,
      closingUcc: result.closingUcc,
      method: result.method,
      recapture: result.recapture,
      terminalLossPossible: result.terminalLossPossible,
      filedOpeningUcc: null,
      filedCcaClaimed: null,
      filedClosingUcc: null,
    })
    rollingOpening = result.closingUcc
  }

  return { class: classRow, years }
}

function storedToComputed(
  classRow: ClassRow,
  s: StoredEntry,
  taxYear: number,
  locked: boolean,
): ComputedYear {
  return {
    taxYear,
    classId: classRow.id,
    classNumber: classRow.classNumber,
    locked,
    persistedId: s.id,
    status: s.status,
    isSeed: s.isSeed,
    isCatchUp: s.isCatchUp,
    catchUpForYear: s.catchUpForYear,
    isOverridden: s.isOverridden,
    journalEntryId: s.journalEntryId,
    postedAt: s.postedAt ? s.postedAt.toISOString() : null,
    openingUcc: D(s.openingUcc),
    additions: D(s.additions),
    dispositions: D(s.dispositions),
    halfYearAdjustment: D(s.halfYearAdjustment),
    accIiAddition: D(s.accIiAddition),
    ccaRate: D(s.ccaRate),
    ccaBase: D(s.ccaBase),
    ccaMax: D(s.ccaMax),
    ccaClaimed: D(s.ccaClaimed),
    closingUcc: D(s.closingUcc),
    method: s.method,
    recapture: D(s.closingUcc) < 0,
    terminalLossPossible: false,
    filedOpeningUcc: s.filedOpeningUcc != null ? D(s.filedOpeningUcc) : null,
    filedCcaClaimed: s.filedCcaClaimed != null ? D(s.filedCcaClaimed) : null,
    filedClosingUcc: s.filedClosingUcc != null ? D(s.filedClosingUcc) : null,
  }
}

/** Convenience: the computed (or stored) year for a single (class, taxYear). */
export async function computedYearFor(
  classId: string,
  taxYear: number,
): Promise<{ schedule: ClassSchedule; year: ComputedYear | null } | null> {
  const schedule = await buildClassSchedule(classId, { throughYear: taxYear })
  if (!schedule) return null
  const year = schedule.years.find((y) => y.taxYear === taxYear) ?? null
  return { schedule, year }
}

/**
 * Persist a recomputed OPEN year back to its CcaScheduleEntry row (idempotent
 * upsert on the unique (classId, taxYear)). Locked years are never written here.
 * Returns the persisted row id. Does NOT post a JE.
 */
export async function persistComputedYear(
  classId: string,
  y: ComputedYear,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const db = tx ?? prisma
  const data = {
    openingUcc: new Prisma.Decimal(y.openingUcc),
    additions: new Prisma.Decimal(y.additions),
    dispositions: new Prisma.Decimal(y.dispositions),
    halfYearAdjustment: new Prisma.Decimal(y.halfYearAdjustment),
    accIiAddition: new Prisma.Decimal(y.accIiAddition),
    ccaRate: new Prisma.Decimal(y.ccaRate),
    ccaBase: new Prisma.Decimal(y.ccaBase),
    ccaMax: new Prisma.Decimal(y.ccaMax),
    ccaClaimed: new Prisma.Decimal(y.ccaClaimed),
    closingUcc: new Prisma.Decimal(y.closingUcc),
    method: y.method,
    isCatchUp: y.isCatchUp,
    catchUpForYear: y.catchUpForYear,
  }
  const row = await db.ccaScheduleEntry.upsert({
    where: { classId_taxYear: { classId, taxYear: y.taxYear } },
    create: { classId, taxYear: y.taxYear, ...data },
    update: data,
  })
  return row.id
}
