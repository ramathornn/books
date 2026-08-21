import prisma from '@/lib/prisma'

/**
 * Parse the per-line `taxCodes String[]` on an invoice line item and compute the
 * tax owed.
 *
 * Each entry is a `"NAME:RATE"` string where RATE is a PERCENTAGE (e.g.
 * `"GST:5"` → 5%). The historical code defaulted a bare/zero rate to 5% for any
 * code containing "GST" — that silent hardcoded 5 is the bug this module fixes.
 *
 * Resolution per code:
 *   rate% = Number.isFinite(parseFloat(rateStr)) ? parseFloat(rateStr)
 *                                                 : lookupByCode(code)
 * Lookup falls back to the TaxCode table (whose `rate` is stored as a FRACTION,
 * e.g. 0.05 for 5%, so it is multiplied by 100 here). If the code is unknown the
 * rate is 0 — we NEVER default to 5.
 */
export interface ParsedTaxLine {
  /** original "NAME:RATE" code string */
  code: string
  /** display name (segment before the first ':') */
  name: string
  /** resolved tax rate as a PERCENTAGE (e.g. 5 for 5%) */
  ratePct: number
  /** tax amount = lineTotal * ratePct / 100, rounded to 2dp */
  amount: number
  /** matched TaxCode.id, when resolved via the table */
  taxCodeId: string | null
  /** how the rate was resolved */
  source: 'inline' | 'lookup' | 'unknown'
}

export interface ParsedSalesTax {
  taxTotal: number
  lines: ParsedTaxLine[]
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Compute tax for a set of line items, each with a `lineTotal` and `taxCodes`.
 * Returns the grand `taxTotal` (rounded 2dp) and a flat per-code breakdown.
 *
 * Unknown codes resolve to a 0% rate (never the legacy hardcoded 5%).
 */
export async function parseSalesTax(
  items: Array<{ lineTotal: number | string; taxCodes: string[] }>
): Promise<ParsedSalesTax> {
  // Collect codes that need a table lookup (no usable inline rate).
  const lookupNames = new Set<string>()
  for (const li of items) {
    for (const code of li.taxCodes ?? []) {
      const rateStr = code.split(':')[1]
      if (!Number.isFinite(parseFloat(rateStr))) {
        lookupNames.add(code.split(':')[0])
      }
    }
  }

  // Resolve unknown codes against the TaxCode table by `code` (exact) or `name`.
  const byKey = new Map<string, { id: string; ratePct: number }>()
  if (lookupNames.size > 0) {
    const names = Array.from(lookupNames)
    const rows = await prisma.taxCode.findMany({
      where: { OR: [{ code: { in: names } }, { name: { in: names } }] },
    })
    for (const r of rows) {
      const entry = { id: r.id, ratePct: Number(r.rate) * 100 }
      byKey.set(r.code, entry)
      byKey.set(r.name, entry)
    }
  }

  const lines: ParsedTaxLine[] = []
  let taxTotal = 0

  for (const li of items) {
    const lineTotal = Number(li.lineTotal) || 0
    for (const code of li.taxCodes ?? []) {
      const name = code.split(':')[0]
      const rateStr = code.split(':')[1]
      const inlineRate = parseFloat(rateStr)

      let ratePct: number
      let taxCodeId: string | null = null
      let source: ParsedTaxLine['source']

      if (Number.isFinite(inlineRate)) {
        ratePct = inlineRate
        source = 'inline'
        taxCodeId = byKey.get(name)?.id ?? null
      } else {
        const hit = byKey.get(name)
        if (hit) {
          ratePct = hit.ratePct
          taxCodeId = hit.id
          source = 'lookup'
        } else {
          // Unknown code → 0%. Never default to 5.
          ratePct = 0
          source = 'unknown'
        }
      }

      const amount = round2(lineTotal * (ratePct / 100))
      taxTotal += amount
      lines.push({ code, name, ratePct, amount, taxCodeId, source })
    }
  }

  return { taxTotal: round2(taxTotal), lines }
}
