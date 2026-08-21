/**
 * Standard searchable receipt filenames.
 *
 * Receipts captured/uploaded today keep their original name or a uuid/timestamp,
 * which isn't searchable. The OCR (receiptOcr.ts ReceiptSchema) and the linked
 * Expense already carry vendor / date / total / currency — this turns them into a
 * consistent display name `YYYY-MM-DD_Vendor_AMOUNTCCY.ext` used for both the
 * Files-manager / Receipts-inbox list and the download filename. Only the display
 * name changes; the on-disk storage path stays a uuid (security + no broken links).
 *
 * Pure + total: never throws, always returns a filesystem-safe name.
 */

const VENDOR_MAX = 40

export interface ReceiptNameParts {
  vendor?: string | null
  date?: Date | string | null
  amount?: number | null
  currency?: string | null
  ext: string
}

function fmtDate(date: Date | string | null | undefined): string {
  if (!date) return 'undated'
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return 'undated'
  return d.toISOString().slice(0, 10)
}

function fmtVendor(vendor: string | null | undefined): string {
  const cleaned = (vendor ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-') // any run of non-alphanumerics → single hyphen
    .replace(/^-+|-+$/g, '') // trim leading/trailing hyphens
    .slice(0, VENDOR_MAX)
    .replace(/-+$/g, '') // re-trim if the slice landed on a hyphen
  return cleaned || 'Unknown-Vendor'
}

function fmtAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0
  const ccy = (currency ?? '').replace(/[^A-Za-z]/g, '').toUpperCase()
  return `${n.toFixed(2)}${ccy}`
}

function fmtExt(ext: string): string {
  const e = (ext ?? '').trim().toLowerCase()
  if (!e) return ''
  return e.startsWith('.') ? e : `.${e}`
}

export function standardReceiptName(parts: ReceiptNameParts): string {
  const base = `${fmtDate(parts.date)}_${fmtVendor(parts.vendor)}_${fmtAmount(parts.amount, parts.currency)}`
  return `${base}${fmtExt(parts.ext)}`
}

/**
 * Convenience for callers that have the source doc's original filename: derives
 * the extension from it and applies the standard name. Pure string work — no fs.
 */
export function receiptDisplayName(args: {
  vendor?: string | null
  date?: Date | string | null
  amount?: number | null
  currency?: string | null
  originalName: string
}): string {
  const m = /(\.[A-Za-z0-9]+)$/.exec(args.originalName || '')
  return standardReceiptName({
    vendor: args.vendor,
    date: args.date,
    amount: args.amount,
    currency: args.currency,
    ext: m ? m[1] : '',
  })
}
