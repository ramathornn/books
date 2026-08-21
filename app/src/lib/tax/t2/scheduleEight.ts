/**
 * Schedule 8 (CCA) projection — `scheduleEight`.
 *
 * A THIN projection of the existing CCA engine into Schedule 8 rows. It does NOT
 * recompute declining-balance math; `buildClassSchedule()` (src/lib/cca/service.ts)
 * is the single source of truth for "what should each year's UCC/claim be". This
 * module:
 *   1. loads every non-archived CCA class' schedule THROUGH the return's tax year,
 *   2. picks the row for that tax year (the FYE's calendar year),
 *   3. projects it into a `ScheduleEightRow` (opening/additions/dispositions/
 *      AccII addition/half-year/base/rate/claim/closing + method),
 *   4. SPLITS the outcome into the Schedule 1 routes:
 *        - Σ ccaClaimed      → Schedule 1 line 403 (CCA deduction),
 *        - recapture (closing < 0) → Schedule 1 line 107 (income addition),
 *        - terminal loss     → Schedule 1 line 404 (deduction),
 *   5. threads each asset's acquired / available-for-use date and HARD-GATES
 *      immediate expensing (method='diep') OFF for property available-for-use
 *      after 2023 with an ERROR (blocker 4: the $1.5M DIEP measure expired).
 *
 * AccII date-gating itself lives in the CCA engine + rates/accii.ts; this layer
 * only routes the DIEP gate (which is a hard prepare-blocker) because the engine
 * computes the schedule without knowing the return is being PREPARED.
 *
 * Reads the DB (class list + assets + schedule). Performs NO writes.
 */

import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'
import { buildClassSchedule, type ComputedYear } from '@/lib/cca/service'
import { immediateExpensingGate } from '@/lib/tax/t2/rates/accii'
import type {
  ScheduleEightRow,
  ScheduleEightResult,
  ValidationIssue,
} from '@/lib/tax/t2/types'

/** Project one computed CCA class-year into a Schedule 8 row. */
function toRow(
  classNumber: string,
  description: string,
  y: ComputedYear,
): ScheduleEightRow {
  return {
    classNumber,
    description,
    openingUcc: round2(y.openingUcc),
    additions: round2(y.additions),
    dispositions: round2(y.dispositions),
    acciiAddition: round2(y.accIiAddition),
    halfYearAdjustment: round2(y.halfYearAdjustment),
    ccaBase: round2(y.ccaBase),
    ccaRate: y.ccaRate,
    ccaClaimed: round2(y.ccaClaimed),
    closingUcc: round2(y.closingUcc),
    method: y.method,
    // closing < 0 ⇒ negative balance recaptured into income (S1 line 107).
    recapture: y.recapture || y.closingUcc < 0,
    // UCC remains but the class is empty (all disposed) ⇒ terminal loss (S1 404).
    terminalLoss: y.terminalLossPossible,
  }
}

/**
 * Build the Schedule 8 projection for a return's tax year.
 *
 * @param taxYear the taxation year (the calendar year the FYE falls in).
 * @returns per-class rows + the S1 totals (403 CCA / 107 recapture / 404 terminal
 *          loss) + verify issues (DIEP-expired ERROR, recapture/terminal-loss
 *          informational WARNINGs).
 */
export async function scheduleEight(taxYear: number): Promise<ScheduleEightResult> {
  const issues: ValidationIssue[] = []
  const rows: ScheduleEightRow[] = []

  // Every live class. Archived classes still in service in PRIOR years are out of
  // scope for a current-year projection (their schedule is closed); we project the
  // active set, which is what the return claims against.
  const classes = await prisma.ccaClass.findMany({
    where: { isArchived: false },
    select: { id: true, classNumber: true, description: true },
    orderBy: { classNumber: 'asc' },
  })

  for (const cls of classes) {
    const schedule = await buildClassSchedule(cls.id, { throughYear: taxYear })
    if (!schedule) continue
    const year = schedule.years.find((y) => y.taxYear === taxYear) ?? null
    // No row for this year ⇒ the class had no UCC/activity in the window; skip it.
    if (!year) continue

    const row = toRow(cls.classNumber, cls.description, year)

    // ── DIEP hard gate (blocker 4) ───────────────────────────────────────────
    // Immediate expensing (method='diep') expired for property available-for-use
    // after 2023. If THIS year's projection used diep OR the class carries
    // additions whose available-for-use date is post-2023 and is flagged for
    // immediate expensing, raise the DIEP_EXPIRED prepare-blocker. We thread the
    // asset available-for-use dates (CcaAsset.acquiredDate, the in-service proxy)
    // for the additions booked in this year.
    if (row.method === 'diep' && row.additions > 0) {
      // Find the latest available-for-use date among additions in this tax year so
      // the gate's date check reflects the property actually expensed.
      const afu = await latestAdditionAvailableForUse(cls.id, taxYear)
      const gate = immediateExpensingGate(afu)
      if (gate) {
        issues.push({
          level: 'error',
          code: gate.code,
          message: `Class ${cls.classNumber}: ${gate.message}`,
          line: 'S8:' + cls.classNumber,
        })
      }
    }

    // Informational verify signals routed to Schedule 1 (non-blocking; the build
    // pipeline surfaces them so the preparer confirms the income/deduction).
    if (row.recapture) {
      issues.push({
        level: 'warning',
        code: 'CCA_RECAPTURE',
        message: `Class ${cls.classNumber}: negative closing UCC (${row.closingUcc}) is recapture income — added on Schedule 1 line 107.`,
        line: 'S1:107',
      })
    }
    if (row.terminalLoss) {
      issues.push({
        level: 'warning',
        code: 'CCA_TERMINAL_LOSS',
        message: `Class ${cls.classNumber}: UCC remains with the class empty — a terminal loss is deducted on Schedule 1 line 404.`,
        line: 'S1:404',
      })
    }

    rows.push(row)
  }

  // ── Schedule 1 routes ──────────────────────────────────────────────────────
  // 403 = Σ ccaClaimed; recapture is an ADDITION on 107 (positive amount), and the
  // terminal loss a DEDUCTION on 404 (positive amount). A class in recapture
  // claims no CCA, so it never double-counts.
  let totalCcaClaimed = 0
  let totalRecapture = 0
  let totalTerminalLoss = 0
  for (const r of rows) {
    totalCcaClaimed = round2(totalCcaClaimed + r.ccaClaimed)
    if (r.recapture) {
      // Recapture = the magnitude of the negative closing UCC.
      totalRecapture = round2(totalRecapture + Math.max(0, -r.closingUcc))
    }
    if (r.terminalLoss) {
      // Terminal loss = the UCC stranded in an empty class.
      totalTerminalLoss = round2(totalTerminalLoss + Math.max(0, r.closingUcc))
    }
  }

  return {
    rows,
    totalCcaClaimed: round2(totalCcaClaimed),
    totalRecapture: round2(totalRecapture),
    totalTerminalLoss: round2(totalTerminalLoss),
    issues,
  }
}

/**
 * The latest available-for-use date among a class's assets ACQUIRED in `taxYear`
 * (the in-service proxy for the DIEP gate). CcaAsset.acquiredDate is the only
 * date the model carries; for the v1 persona acquisition ≈ available-for-use.
 * Falls back to Dec-31 of the tax year when the class has no dated asset rows
 * (so a class flagged diep with undated additions still trips the post-2023 gate).
 */
async function latestAdditionAvailableForUse(
  classId: string,
  taxYear: number,
): Promise<Date> {
  const start = new Date(Date.UTC(taxYear, 0, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999))
  const asset = await prisma.ccaAsset.findFirst({
    where: {
      classId,
      isArchived: false,
      acquiredDate: { gte: start, lte: end },
    },
    orderBy: { acquiredDate: 'desc' },
    select: { acquiredDate: true },
  })
  return asset?.acquiredDate ?? new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999))
}
