/**
 * T1 export assembly — `buildT1Export`.
 *
 * The PRIMARY deliverable of "Prepare & verify" is NOT a NETFILE file (the app
 * can never transmit). It is a re-keying sheet: one transcription card per slip
 * (T5 / T4A / T3) with the CRA box numbers + amounts exactly as they appear on
 * the slip screen of certified software (Wealthsimple / TurboTax / UFile), plus
 * the non-slip items the owner types by hand (RRSP from the NOA, instalments,
 * capital gains → Schedule 3, spouse identification). The T1 line-by-line totals
 * are demoted to a RECONCILIATION block — a cross-check ("after entering slips,
 * line 12000 should read $X"), never the primary surface (SPEC item 3).
 *
 * This module is PURE — no DB, no clock, no randomness apart from the sha256 of
 * the canonical payload. The SIN/DOB live only in the in-memory `identification`
 * jacket the caller regenerates on download; nothing here persists them. The
 * checksum is computed over a CANONICAL payload that EXCLUDES the SIN/DOB jacket,
 * so it is stable to persist and never leaks PII (mirrors filing.ts: persist the
 * checksum, regenerate the SIN-bearing artifact on demand).
 */

import crypto from 'node:crypto'

import { round2 } from '@/lib/tax/round'
import type {
  ExportIdentification,
  NonSlipItem,
  SlipTranscriptionCard,
  T1Export,
  T1Lines,
  T1Result,
  ValidationReport,
} from '@/lib/tax/t1/types'

/**
 * Build the complete prepare-&-verify export from the computed result plus the
 * already-assembled transcription cards, non-slip items, and identification
 * jacket. `reconciliationLines` is derived from the result's line snapshot — it
 * is the cross-check surface only.
 *
 * @param result          the pure compute output (federal/AB breakdown + lines).
 * @param identification  the (in-memory) identity jacket; SIN/DOB present here
 *                        are excluded from the persisted checksum.
 * @param cards           one transcription card per effective slip.
 * @param nonSlip         non-slip items (RRSP, instalments, capital gains, etc.).
 * @param report          the verify-before-prepare validation report.
 */
export function buildT1Export(
  result: T1Result,
  identification: ExportIdentification,
  cards: SlipTranscriptionCard[],
  nonSlip: NonSlipItem[],
  report: ValidationReport,
): T1Export {
  const reconciliationLines = buildReconciliationLines(result)

  const export_: Omit<T1Export, 'checksum'> = {
    taxYear: result.taxYear,
    province: result.province,
    identification,
    transcriptionCards: cards,
    nonSlipItems: nonSlip,
    reconciliationLines,
    result,
    report,
    engineVersion: result.engineVersion,
  }

  return { ...export_, checksum: checksumOf(export_) }
}

/**
 * The RECONCILIATION block: the subset of T1 lines the owner uses to confirm the
 * software agrees with the app after they finish re-keying. Kept to the totals
 * that actually appear on a software summary screen (income, net/taxable income,
 * credits, payable, refund/owing) rather than every internal credit-detail line.
 */
const RECONCILIATION_LINES: readonly string[] = [
  '12000', // taxable amount of eligible + non-eligible dividends
  '12010', // taxable amount of non-eligible (other) dividends
  '12700', // taxable capital gains (opt-in)
  '15000', // total income
  '20800', // RRSP deduction
  '23600', // net income
  '26000', // taxable income
  '30300', // spouse amount (federal)
  '40425', // federal dividend tax credit
  '42000', // net federal tax
  '42800', // net Alberta tax
  '43500', // total payable
  '43700', // total income tax deducted (withholding)
  '47600', // instalments paid
  '48400', // refund
  '48500', // balance owing
]

/** Pull the reconciliation subset out of the full computed line snapshot. */
function buildReconciliationLines(result: T1Result): T1Lines {
  const out: T1Lines = {}
  for (const line of RECONCILIATION_LINES) {
    const v = result.lines[line]
    if (Number.isFinite(v)) out[line] = round2(v as number)
  }
  return out
}

/**
 * sha256 over the CANONICAL export payload, with the SIN/DOB jacket scrubbed so
 * the persisted checksum carries no PII and is stable across regenerations. The
 * canonicalization sorts object keys so semantically-equal payloads hash equal.
 */
function checksumOf(payload: Omit<T1Export, 'checksum'>): string {
  const safe = {
    ...payload,
    identification: scrubIdentification(payload.identification),
  }
  return crypto.createHash('sha256').update(canonicalize(safe), 'utf8').digest('hex')
}

/** Replace the SIN/DOB with stable non-PII placeholders for the checksum only. */
function scrubIdentification(id: ExportIdentification): ExportIdentification {
  return {
    ...id,
    taxpayerSin: id.taxpayerSin ? 'SIN_PRESENT' : null,
    taxpayerDob: id.taxpayerDob ? 'DOB_PRESENT' : null,
    spouseSin: id.spouseSin ? 'SIN_PRESENT' : null,
  }
}

/** Deterministic JSON: object keys sorted recursively so the hash is stable. */
function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k])
    return out
  }
  return value
}

// ---------------------------------------------------------------------------
// Flat printable renderings (CSV + plain text) — the re-keying worksheet.
// ---------------------------------------------------------------------------

/** Escape one CSV field (RFC-4180-ish: quote when it contains , " or newline). */
function csvField(v: string | number): string {
  const s = String(v)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** A 2-dp money string for the printable surfaces (no currency symbol). */
function fmtMoney(n: number): string {
  return round2(n).toFixed(2)
}

/**
 * Flat CSV of the export: a section column drives the layout so one sheet holds
 * the transcription cards (primary), the non-slip items, and the reconciliation
 * block (cross-check). This is the printable worksheet the owner works from
 * while typing into certified software.
 */
export function t1ExportToCsv(ex: T1Export): string {
  const rows: Array<Array<string | number>> = []
  rows.push(['Section', 'Slip / Item', 'Box / Line', 'Label', 'Amount'])

  // PRIMARY — per-slip transcription cards.
  for (const card of ex.transcriptionCards) {
    const slipLabel = `${card.slipType} — ${card.issuerLabel}${
      card.slipNumber ? ` (#${card.slipNumber})` : ''
    }`
    for (const box of card.boxes) {
      rows.push(['Slip transcription', slipLabel, box.boxNumber, box.label, fmtMoney(box.amount)])
    }
  }

  // Non-slip items entered by hand.
  for (const item of ex.nonSlipItems) {
    rows.push([
      'Non-slip entry',
      item.label,
      item.line,
      item.help ?? '',
      item.amount === null || item.amount === undefined ? '' : fmtMoney(item.amount),
    ])
  }

  // RECONCILIATION — verification cross-check only.
  for (const [line, amount] of Object.entries(ex.reconciliationLines)) {
    rows.push(['Reconciliation (verify only)', '', line, `Line ${line} should read`, fmtMoney(amount)])
  }

  return rows.map((r) => r.map(csvField).join(',')).join('\r\n')
}

/**
 * Plain-text printable form of the export — the same three sections in a
 * human-readable layout for printing/PDF. No SIN/DOB are rendered (the jacket is
 * masked by the caller before this runs; only the masked fields reach here).
 */
export function t1ExportToText(ex: T1Export): string {
  const lines: string[] = []
  const rule = '='.repeat(64)

  lines.push(rule)
  lines.push(`T1 ${ex.taxYear} — Prepare & verify worksheet (${ex.province})`)
  lines.push('This is NOT a return. Re-key the slips below into certified NETFILE software.')
  lines.push(rule)
  lines.push('')

  lines.push('IDENTIFICATION')
  lines.push(`  Taxpayer: ${ex.identification.taxpayerName || '(unset)'}`)
  lines.push(`  SIN: ${ex.identification.taxpayerSin ?? '(masked)'}`)
  lines.push(`  Province (Dec 31): ${ex.identification.province}`)
  lines.push(`  Marital status: ${ex.identification.maritalStatus}`)
  if (ex.identification.spouseFirstName) {
    lines.push(`  Spouse: ${ex.identification.spouseFirstName}`)
    lines.push(`  Spouse SIN: ${ex.identification.spouseSin ?? '(masked)'}`)
    if (ex.identification.spouseNetIncome !== null) {
      lines.push(`  Spouse net income (line 23600): ${fmtMoney(ex.identification.spouseNetIncome)}`)
    }
  }
  lines.push('')

  lines.push('-- SLIPS TO TRANSCRIBE (primary) ----------------------------------')
  if (ex.transcriptionCards.length === 0) {
    lines.push('  (no slips)')
  }
  for (const card of ex.transcriptionCards) {
    lines.push('')
    lines.push(
      `  ${card.slipType} — ${card.issuerLabel}${card.slipNumber ? ` (#${card.slipNumber})` : ''}`,
    )
    for (const box of card.boxes) {
      lines.push(`    Box ${box.boxNumber.padEnd(4)} ${box.label}: ${fmtMoney(box.amount)}`)
    }
  }
  lines.push('')

  if (ex.nonSlipItems.length > 0) {
    lines.push('-- NON-SLIP ITEMS (enter by hand) ---------------------------------')
    for (const item of ex.nonSlipItems) {
      const amt = item.amount === null || item.amount === undefined ? '—' : fmtMoney(item.amount)
      lines.push(`  Line ${item.line} ${item.label}: ${amt}`)
      if (item.help) lines.push(`      ${item.help}`)
    }
    lines.push('')
  }

  lines.push('-- RECONCILIATION (verify only — do NOT re-key) -------------------')
  lines.push('  After entering the slips above, your software should show:')
  for (const [line, amount] of Object.entries(ex.reconciliationLines)) {
    lines.push(`    Line ${line}: ${fmtMoney(amount)}`)
  }
  lines.push('')

  lines.push(rule)
  lines.push(`Engine: ${ex.engineVersion}`)
  lines.push(`Checksum: ${ex.checksum}`)
  lines.push(`Verified: ${ex.report.ok ? 'PASS' : 'FAILED — resolve errors before re-keying'}`)
  lines.push(rule)

  return lines.join('\n')
}
