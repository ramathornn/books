/**
 * T2 re-key worksheet export — the PRIMARY "Prepare & verify" deliverable.
 *
 * The corporate analogue of the T1 transcription sheet: TWO worksheets the owner
 * re-keys into certified software / Alberta TRA Net File —
 *   - the FEDERAL T2 worksheet (GIFI carries 2599/3499/3620/9999, Schedule 1
 *     500/510/300, Schedule 8 per class, Schedule 3 Part 2, Schedule 7 410/425,
 *     SBD 430, full-rate 550, GRR 638, Part I 700, ART 604, Part IV 712, RDTOH
 *     530/545, dividend refund 784, GRIP 770), and
 *   - the ALBERTA AT1 worksheet (068, AB SBD 061/062, 070/072, allocation 1.0,
 *     IEG 129).
 * Each line carries human provenance microcopy ("from GIFI 9999", "Σ Schedule 8",
 * "posted dividend JEs"). The line-by-line reconciliation map is a verification
 * cross-check only — NOT the primary re-key surface.
 *
 * Persistence is checksum-only (sha256 of the canonical payload); the route
 * regenerates the payload on authorized download. Pure: no DB, no I/O beyond the
 * crypto hash.
 */

import crypto from 'node:crypto'

import { round2 } from '@/lib/tax/round'
import type {
  FilingDates,
  ReKeyWorksheet,
  T2Export,
  T2ExportIdentification,
  T2Result,
  ValidationReport,
  WorksheetLine,
} from '@/lib/tax/t2/types'

/** Add whole months to a date (UTC), clamping the day for short months. */
function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + months
  const day = d.getUTCDate()
  const out = new Date(Date.UTC(y, m, 1))
  // Clamp the day to the last day of the resulting month.
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(day, lastDay))
  return out
}

/** Compute the filing + balance-due dates from the FYE. */
export function filingDatesFor(fiscalYearEnd: Date): FilingDates {
  return {
    fiscalYearEnd: fiscalYearEnd.toISOString().slice(0, 10),
    // T2/AT1 filing deadline = FYE + 6 months.
    filingDue: addMonths(fiscalYearEnd, 6).toISOString().slice(0, 10),
    // Balance due = FYE + 3 months for an SBD-claiming CCPC.
    balanceDue: addMonths(fiscalYearEnd, 3).toISOString().slice(0, 10),
  }
}

/** A worksheet line builder that reads off the merged result line map. */
function ln(line: string, label: string, amount: number, provenance: string): WorksheetLine {
  return { line, label, amount: round2(amount), provenance }
}

/**
 * Build the FEDERAL T2 re-key worksheet from the combined result. Pulls the
 * effective line amounts from the federal/GIFI/Schedule results.
 */
function buildFederalWorksheet(result: T2Result): ReKeyWorksheet {
  const f = result.federal
  const g = result.gifi
  const s8 = result.scheduleEight
  const div = result.dividendsPaid
  const lines: WorksheetLine[] = []

  // GIFI carries (Schedule 100 / 125 → T2 page-1 attach).
  lines.push(ln('2599', 'GIFI total assets', g.totalAssets2599, 'from GIFI 2599 (Schedule 100)'))
  lines.push(ln('3499', 'GIFI total liabilities', g.totalLiabilities3499, 'from GIFI 3499 (Schedule 100)'))
  lines.push(ln('3620', 'GIFI total equity', g.totalEquity3620, 'from GIFI 3620 (Schedule 100)'))
  lines.push(ln('9999', 'GIFI net income/loss after tax', g.netIncome9999, 'from GIFI 9999 (Schedule 125, pre-close)'))

  // Schedule 1: net income for tax purposes. The book-to-tax bridge (additions
  // 103/104/295/107 → total 500; deductions 403/404 → total 510) is computed in
  // buildT2 and carried on the merged line map; read it back here so the
  // worksheet 500/510 match the engine, not a partial re-derivation.
  lines.push(ln('9999b', 'Net income/loss per financial statements', g.netIncome9999, 'from GIFI 9999 (book net income, after tax)'))
  const nonDeductible121 = result.lines['S1:121'] ?? 0
  if (nonDeductible121 > 0) {
    lines.push(ln('121', 'Non-deductible fines, penalties and interest on tax (Schedule 1)', nonDeductible121, 'configured non-deductible account, 100% add-back (ITA 18(1)(t), 67.5, 67.6)'))
  }
  lines.push(ln('500', 'Total additions (Schedule 1)', result.lines['S1:500'] ?? sum(s8.totalRecapture), 'Σ Schedule 1 additions (tax provision 103, amortization 104, non-deductible 121, meals 295, recapture 107)'))
  lines.push(ln('510', 'Total deductions (Schedule 1)', result.lines['S1:510'] ?? sum(s8.totalCcaClaimed, s8.totalTerminalLoss), 'Σ Schedule 1 deductions (CCA 403, terminal loss 404)'))
  lines.push(ln('300', 'Net income/loss for tax purposes', f.taxableIncome, 'Schedule 1 line 300 = 9999 + 500 − 510'))

  // Schedule 8 — one line per class (CCA claimed).
  for (const row of s8.rows) {
    lines.push(ln(`S8-${row.classNumber}`, `Schedule 8 class ${row.classNumber} CCA`, row.ccaClaimed, `Schedule 8 class ${row.classNumber} (${row.method})`))
  }
  lines.push(ln('403', 'Total CCA (Schedule 8 → Schedule 1)', s8.totalCcaClaimed, 'Σ Schedule 8 ccaClaimed'))
  if (s8.totalRecapture > 0) lines.push(ln('107', 'Recapture of CCA', s8.totalRecapture, 'Schedule 8 negative closing UCC'))
  if (s8.totalTerminalLoss > 0) lines.push(ln('404', 'Terminal loss', s8.totalTerminalLoss, 'Schedule 8 stranded UCC in an empty class'))

  // Schedule 3 Part 2 — dividends paid.
  lines.push(ln('S3-elig', 'Eligible dividends paid (Schedule 3 Part 2)', div.eligible, 'posted dividend JEs tagged eligible'))
  lines.push(ln('S3-nonelig', 'Non-eligible dividends paid (Schedule 3 Part 2)', div.nonEligible, 'posted dividend JEs (non-eligible / legacy)'))

  // Schedule 7 — SBD calc.
  lines.push(ln('410', 'Reduced business limit (Schedule 7)', f.businessLimit, 'Schedule 7 line 410 (500,000 − grind)'))
  lines.push(ln('425', 'Small-business income (Schedule 7)', f.sbdIncome, 'Schedule 7 line 425 = min(ABI, limit, TI)'))

  // T2 page 3 — Part I tax build.
  lines.push(ln('430', 'Small business deduction', result.lines['T2:430'] ?? 0, 'T2 line 430 (19% of SBD income)'))
  lines.push(ln('550', 'Full-rate taxable income', f.fullRateTaxableIncome, 'T2 line 550 = TI − SBD income − AII'))
  lines.push(ln('638', 'General rate reduction', result.lines['T2:638'] ?? 0, 'T2 line 638 (13% of full-rate TI)'))
  lines.push(ln('604', 'Additional refundable tax (ART)', f.art, 'T2 line 604 = 10.67% × min(AII, TI)'))
  lines.push(ln('700', 'Part I tax payable', f.partOneTax, 'T2 line 700 (incl. ART + any PSB tax)'))

  // Part IV / RDTOH / dividend refund / GRIP.
  lines.push(ln('712', 'Part IV tax', f.partFourTax, 'T2 line 712 = 38.33% × portfolio dividends received'))
  lines.push(ln('530', 'Eligible RDTOH (closing)', f.closingErdtoh, 'T2 line 530'))
  lines.push(ln('545', 'Non-eligible RDTOH (closing)', f.closingNerdtoh, 'T2 line 545'))
  lines.push(ln('784', 'Dividend refund', f.dividendRefund, 'T2 line 784 (pool-specific, ITA 129(1) ordering)'))
  lines.push(ln('770', 'GRIP (closing)', f.closingGrip, 'T2 line 770 (→ next year opening)'))

  return { form: 'T2', title: 'Federal T2 — corporate income tax return (re-key worksheet)', lines }
}

/** Build the ALBERTA AT1 re-key worksheet. */
function buildAlbertaWorksheet(result: T2Result): ReKeyWorksheet {
  const a = result.alberta
  const lines: WorksheetLine[] = [
    ln('068', 'Alberta taxable income', a.albertaTaxableIncome, 'AT1 line 068 (federal TI ± Schedule 12)'),
    ln('061', 'Alberta small-business income', a.albertaSbdIncome, 'AT1 line 061 = min(ABI, reduced limit × allocation)'),
    ln('062', 'Alberta small business deduction', a.albertaSbdAmount, 'AT1 line 062 (6-point spread → 2%)'),
    ln('063', 'General-rate income (8%)', a.generalRateIncome, 'AT1 (TI − AB SBD income)'),
    ln('070', 'Alberta tax before credits', a.taxBeforeCredits, 'AT1 line 070 (8% general / 2% small business)'),
    ln('129', 'Innovation Employment Grant', a.innovationEmploymentGrant, 'AT1 line 129 (default 0)'),
    ln('072', 'Net Alberta tax payable', a.albertaTaxPayable, 'AT1 line 072 (clamped ≥ 0)'),
    ln('allocation', 'Alberta allocation factor', 1.0, 'single Alberta permanent establishment = 1.0'),
  ]
  return { form: 'AT1', title: 'Alberta AT1 — corporate income tax return (re-key worksheet)', lines }
}

function sum(...xs: number[]): number {
  return round2(xs.reduce((a, b) => a + b, 0))
}

/**
 * Build the complete T2 export from the combined result + identity + report.
 * Pure (only the crypto hash). The checksum binds the canonical payload without
 * persisting any SIN/identity.
 */
export function buildT2Export(
  result: T2Result,
  identification: T2ExportIdentification,
  report: ValidationReport,
): T2Export {
  const federalWorksheet = buildFederalWorksheet(result)
  const albertaWorksheet = buildAlbertaWorksheet(result)
  const dates = filingDatesFor(new Date(`${result.fiscalYearEnd}T00:00:00.000Z`))

  // The reconciliation map = the full merged line totals (verification only).
  const reconciliationLines = { ...result.lines }

  const ex: Omit<T2Export, 'checksum'> = {
    taxationYear: result.taxationYear,
    province: result.province,
    identification,
    worksheets: [federalWorksheet, albertaWorksheet],
    reconciliationLines,
    result,
    report,
    dates,
    engineVersion: result.engineVersion,
  }

  // Checksum over the canonical payload, EXCLUDING the SIN-bearing identity (so a
  // persisted checksum reveals nothing) but binding the numeric output + dates.
  const canonical = JSON.stringify({
    taxationYear: ex.taxationYear,
    province: ex.province,
    worksheets: ex.worksheets,
    reconciliationLines: ex.reconciliationLines,
    engineVersion: ex.engineVersion,
    dates: ex.dates,
    ok: report.ok,
  })
  const checksum = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex')

  return { ...ex, checksum }
}

// ---------------------------------------------------------------------------
// Flat printable serializers (CSV / text) for the export route.
// ---------------------------------------------------------------------------

/** CSV of both worksheets (form, line, label, amount, provenance). */
export function t2ExportToCsv(ex: T2Export): string {
  const rows: string[] = ['form,line,label,amount,provenance']
  for (const ws of ex.worksheets) {
    for (const l of ws.lines) {
      rows.push([ws.form, l.line, csvCell(l.label), l.amount.toFixed(2), csvCell(l.provenance)].join(','))
    }
  }
  return rows.join('\r\n') + '\r\n'
}

/** Plain-text printable worksheet (both forms). */
export function t2ExportToText(ex: T2Export): string {
  const out: string[] = []
  const stamp = ex.report.ok ? '' : '   *** PROVISIONAL — VERIFICATION FAILED ***'
  out.push(`T2 / AT1 RE-KEY WORKSHEET${stamp}`)
  out.push(`Corporation: ${ex.identification.legalName}`)
  out.push(`BN+RC: ${ex.identification.bnRc}    Alberta CAN: ${ex.identification.albertaCan}`)
  out.push(`Fiscal year: ${ex.identification.fiscalYearStart} → ${ex.identification.fiscalYearEnd}`)
  out.push(`Filing due: ${ex.dates.filingDue}    Balance due: ${ex.dates.balanceDue}`)
  out.push('')
  for (const ws of ex.worksheets) {
    out.push(ws.title)
    out.push('-'.repeat(ws.title.length))
    for (const l of ws.lines) {
      out.push(`  ${l.line.padEnd(12)} ${l.label.padEnd(44)} ${l.amount.toFixed(2).padStart(14)}   (${l.provenance})`)
    }
    out.push('')
  }
  out.push(`Engine version: ${ex.engineVersion}`)
  out.push(`Checksum: ${ex.checksum}`)
  return out.join('\n') + '\n'
}

function csvCell(s: string): string {
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}
