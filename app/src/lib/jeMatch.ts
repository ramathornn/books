/**
 * Pure matcher: decide whether an OCR'd receipt/invoice confidently belongs to a
 * single already-posted expense journal entry, so its source document can be
 * attached directly to that JE. No DB access here — the caller fetches the
 * same-date-window candidate JEs and passes them in, so this logic stays
 * unit-testable. Confident = a unique candidate that matches on BOTH amount (to
 * the cent) AND a distinctive vendor token. Anything else is ambiguous and gets
 * parked for human review — we never auto-attach on a guess.
 */

export interface OcrLike {
  vendor?: string | null
  total: number
  date?: string | null
  /** ISO currency of `total` (default CAD when absent). */
  currency?: string | null
  /** `total` converted to CAD (Bank of Canada rate), set by the loader when the
   *  receipt currency isn't CAD. Enables matching a USD receipt to its CAD JE. */
  cadTotal?: number | null
}

export interface JeCandidate {
  id: string
  entryDate: Date
  totalDebit: number
  description: string
  memo: string
}

export interface MatchResult {
  /** The single confidently-matched JE, or null. */
  je: JeCandidate | null
  /** True when something matched on amount but we can't safely pick one → review. */
  ambiguous: boolean
  /** The candidates that survived amount (and, when used, vendor) filtering. */
  candidates: JeCandidate[]
}

/** Gross-amount tolerance in dollars (covers rounding on tax-inclusive totals). */
export const AMOUNT_TOLERANCE = 0.02

/**
 * Percentage band for cross-currency matches. A USD receipt converted at the
 * Bank of Canada mid-rate won't equal the CAD posted from a card statement — the
 * card adds an FX markup AND strikes its own rate on a different day, so the
 * observed spread runs to ~6% on small charges. 10% absorbs that; the vendor-token
 * + ±5-day + uniqueness gates keep the wider band from causing a false attach.
 */
export const FX_TOLERANCE_PCT = 0.1

/** The amount to match a candidate against, and the tolerance to allow. */
function amountTarget(ocr: OcrLike): { target: number; tol: number } {
  const isFx =
    !!ocr.currency &&
    ocr.currency.toUpperCase() !== 'CAD' &&
    typeof ocr.cadTotal === 'number' &&
    ocr.cadTotal > 0
  if (isFx) {
    const target = ocr.cadTotal as number
    return { target, tol: Math.max(AMOUNT_TOLERANCE, target * FX_TOLERANCE_PCT) }
  }
  return { target: ocr.total, tol: AMOUNT_TOLERANCE }
}

// Generic words (≥4 chars) that must not, on their own, confirm a vendor.
const STOPWORDS = new Set([
  'services',
  'service',
  'company',
  'limited',
  'corp',
  'corporation',
  'payment',
  'invoice',
  'transaction',
  'incorporated',
])

/**
 * Vendor aliases where the receipt's brand differs from the bank/card statement
 * descriptor that became the JE text. Bidirectional: a token on either side pulls
 * in the other so the vendor gate still fires.
 */
const VENDOR_ALIASES: Record<string, string[]> = {
  anthropic: ['claude'],
  claude: ['anthropic'],
}

/** Distinctive lowercase tokens from a vendor name (drops short + generic words). */
export function vendorTokens(vendor?: string | null): string[] {
  const base = (vendor || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  const out = new Set(base)
  for (const t of base) for (const a of VENDOR_ALIASES[t] ?? []) out.add(a)
  return [...out]
}

function jeText(c: JeCandidate): string {
  return `${c.description} ${c.memo}`.toLowerCase()
}

export function selectMatch(ocr: OcrLike, candidates: JeCandidate[]): MatchResult {
  const { target, tol } = amountTarget(ocr)
  const byAmount = candidates.filter((c) => Math.abs(c.totalDebit - target) <= tol)
  if (byAmount.length === 0) return { je: null, ambiguous: false, candidates: [] }

  const tokens = vendorTokens(ocr.vendor)
  const byVendor = tokens.length
    ? byAmount.filter((c) => {
        // Also test a space/punctuation-stripped form, since bank descriptors
        // split brand names ("ANTHRO PIC" → "anthropic", "DNH*GODADDY" → "godaddy").
        const text = jeText(c)
        const squished = text.replace(/[^a-z0-9]/g, '')
        return tokens.some((t) => text.includes(t) || squished.includes(t))
      })
    : []

  if (byVendor.length === 1) return { je: byVendor[0], ambiguous: false, candidates: byVendor }
  if (byVendor.length > 1) return { je: null, ambiguous: true, candidates: byVendor }

  // Amount matched but no distinctive vendor confirmation — never auto-attach.
  return { je: null, ambiguous: true, candidates: byAmount }
}
