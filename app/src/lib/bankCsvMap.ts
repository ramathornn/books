/**
 * Shared bank-CSV column-mapping logic — the SINGLE source of truth used by
 * both the in-app CSV import wizard (CsvImportDialog.tsx) and the headless
 * POST /api/banking/import-csv endpoint.
 *
 * It turns a parsed CSV (headers + positional rows from `parseCsvRows`) into
 * normalized ImportRow[] for `importBankTransactions` — handling bank presets
 * (rbc_business / rbc_personal / wise), header auto-detection, the three
 * amount-sign conventions, and per-column date-order resolution (mdy/dmy/iso).
 *
 * Pure + dep-free (besides the ImportRow shape) so it runs unchanged on the
 * client and on the server.
 */
import type { ImportRow } from '@/lib/bankImport'

export type DateFormat = 'auto' | 'mdy' | 'dmy' | 'iso'
export type AmountSign = 'standard' | 'split-in-out' | 'cc-flip'

export interface ColumnMap {
  date: string
  description: string
  amount: string
  amountIn: string
  amountOut: string
  balance: string
  amountSign: AmountSign
  dateFormat: DateFormat
}

/** Preset keys accepted by the API's optional `format` override. */
export type PresetKey = 'rbc_business' | 'rbc_personal' | 'wise' | 'custom'

export const PRESETS: Record<string, Partial<ColumnMap>> = {
  // RBC personal CSV columns: Account Type, Account Number, Transaction Date,
  // Cheque Number, Description 1, Description 2, CAD$, USD$. CAD$/USD$ are
  // *currency* columns (not money-in/money-out): a CAD account's signed amount
  // lives in CAD$. For a USD account, point the amount column at USD$ instead.
  rbc_personal: {
    date: 'Transaction Date',
    description: 'Description 1',
    amount: 'CAD$',
    balance: 'Account Balance',
    amountSign: 'standard',
  },
  // RBC business chequing CSV columns: Account Type, Account Number, Transaction Date, Cheque Number, Description 1, Description 2, CAD$, USD$
  rbc_business: {
    date: 'Transaction Date',
    description: 'Description 1',
    amount: 'CAD$',
    balance: '',
    amountSign: 'standard',
  },
  wise: {
    date: 'Date',
    description: 'Description',
    amount: 'Amount',
    balance: 'Running Balance',
    amountSign: 'standard',
    // Wise statement dates are ALWAYS DD-MM-YYYY (European). Pin the order so a
    // file with all early-month dates can't misparse via auto-detect.
    dateFormat: 'dmy',
  },
  custom: {},
}

export function parseAmount(s: string): number {
  if (!s) return 0
  const cleaned = s.replace(/[^0-9.\-]/g, '')
  const n = parseFloat(cleaned)
  return isNaN(n) ? 0 : n
}

const SLASH_DATE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/

/**
 * Infer whether slash/dash dates in a column are month-first (mdy) or
 * day-first (dmy) by looking for an unambiguous value: a first part > 12 can
 * only be a day (=> dmy), a second part > 12 can only be a day (=> mdy).
 * Ties / all-ambiguous default to mdy (North-American bank exports).
 */
export function detectDateOrder(values: string[]): 'mdy' | 'dmy' {
  let mdy = 0
  let dmy = 0
  for (const v of values) {
    const m = (v || '').trim().match(SLASH_DATE)
    if (!m) continue
    const a = parseInt(m[1], 10)
    const b = parseInt(m[2], 10)
    if (a > 12 && b <= 12) dmy++
    else if (b > 12 && a <= 12) mdy++
  }
  return dmy > mdy ? 'dmy' : 'mdy'
}

/** Resolve the date order to use for a column given the user's choice. */
export function resolveDateOrder(
  fmt: DateFormat,
  values: string[]
): 'mdy' | 'dmy' | 'iso' {
  if (fmt === 'auto') return detectDateOrder(values)
  return fmt
}

/** Parse one date cell to YYYY-MM-DD using a known column order. */
export function parseDate(s: string, order: 'mdy' | 'dmy' | 'iso'): string {
  if (!s) return ''
  const t = s.trim()
  // ISO always wins regardless of the column's chosen order.
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  const m = t.match(SLASH_DATE)
  if (m) {
    const [, p1, p2, yRaw] = m
    const y = yRaw.length === 2 ? '20' + yRaw : yRaw
    const monthStr = order === 'dmy' ? p2 : p1
    const dayStr = order === 'dmy' ? p1 : p2
    const month = parseInt(monthStr, 10)
    const day = parseInt(dayStr, 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  // last resort: let the engine try (handles "Jan 5, 2025" etc.)
  const d = new Date(t)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

/**
 * Pick the best-fit preset key for a CSV given its headers. Mirrors the
 * heuristic the wizard runs on upload. Returns 'custom' when nothing matches.
 */
export function detectPreset(headers: string[]): PresetKey {
  // Wise: the 'TransferWise ID' column is the most reliable signal.
  if (headers.includes('TransferWise ID')) {
    return 'wise'
  }
  // RBC: an export carrying both Account Type and Account Number is RBC's
  // statement shape (personal has a USD$ column, business doesn't).
  if (headers.includes('Account Type') && headers.includes('Account Number')) {
    return headers.includes('USD$') ? 'rbc_personal' : 'rbc_business'
  }
  if (headers.some((x) => /CAD\$|Account Balance/.test(x))) {
    return headers.includes('USD$') ? 'rbc_personal' : 'rbc_business'
  }
  if (headers.some((x) => /Running Balance|Source amount/i.test(x))) {
    return 'wise'
  }
  return 'custom'
}

/**
 * Build a concrete ColumnMap for a CSV by applying a preset and keeping only
 * the columns that actually exist in `headers`. Used by both the wizard's
 * preset-apply and the API's auto/override resolution.
 */
export function buildColumnMapForPreset(
  presetKey: string,
  headers: string[]
): ColumnMap {
  const p = PRESETS[presetKey] || {}
  const has = (h?: string) => (h && headers.includes(h) ? h : '')
  return {
    date: has(p.date),
    description: has(p.description),
    amount: has(p.amount),
    amountIn: has(p.amountIn),
    amountOut: has(p.amountOut),
    balance: has(p.balance),
    amountSign: p.amountSign || 'standard',
    // Honor a preset's pinned date order (e.g. Wise = 'dmy'); otherwise auto.
    dateFormat: p.dateFormat || 'auto',
  }
}

export interface MappedRow extends ImportRow {
  raw: Record<string, string>
}

/**
 * Map parsed CSV (headers + positional rows) to normalized rows using a
 * ColumnMap. This is the exact logic the wizard's `buildPreview` ran, lifted
 * out verbatim so the UI and the API produce identical results.
 *
 * Returns [] if the required date/description columns aren't mapped.
 */
export function mapRows(
  headers: string[],
  rawRows: string[][],
  columnMap: ColumnMap
): MappedRow[] {
  if (rawRows.length === 0) return []
  const idx = (h: string) => headers.indexOf(h)
  const dateIdx = idx(columnMap.date)
  const descIdx = idx(columnMap.description)
  const amountIdx = idx(columnMap.amount)
  const inIdx = idx(columnMap.amountIn)
  const outIdx = idx(columnMap.amountOut)
  const balIdx = idx(columnMap.balance)

  if (dateIdx < 0 || descIdx < 0) return []

  // Resolve the date order once from the whole column, then apply per row.
  const dateOrder = resolveDateOrder(
    columnMap.dateFormat,
    rawRows.map((r) => r[dateIdx] || '')
  )

  const parsed: MappedRow[] = []
  for (const r of rawRows) {
    const date = parseDate(r[dateIdx] || '', dateOrder)
    const description = (r[descIdx] || '').trim()
    let amount = 0

    if (columnMap.amountSign === 'split-in-out') {
      const inV = inIdx >= 0 ? parseAmount(r[inIdx] || '') : 0
      const outV = outIdx >= 0 ? parseAmount(r[outIdx] || '') : 0
      amount = inV - outV
    } else if (columnMap.amountSign === 'cc-flip') {
      const v = amountIdx >= 0 ? parseAmount(r[amountIdx] || '') : 0
      amount = -v // cc statements often have charges as positive
    } else {
      amount = amountIdx >= 0 ? parseAmount(r[amountIdx] || '') : 0
    }

    const balanceAfter = balIdx >= 0 ? parseAmount(r[balIdx] || '') : undefined

    if (!date) continue
    if (amount === 0 && !description) continue

    parsed.push({
      date,
      description,
      amount,
      balanceAfter,
      raw: headers.reduce(
        (acc, h, i) => ({ ...acc, [h]: r[i] || '' }),
        {} as Record<string, string>
      ),
    })
  }
  return parsed
}
