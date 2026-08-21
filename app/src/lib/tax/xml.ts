import { T5_BOXES, type BoxDescriptor } from '@/lib/tax/descriptors/t5'
import { T4A_BOXES } from '@/lib/tax/descriptors/t4a'
import { money2 } from '@/lib/tax/round'

/**
 * Hand-rolled XML serializer for CRA T5 / T4A information returns.
 *
 * The design (§3, §7) deliberately avoids `xmlbuilder2` / `fast-xml-parser` and
 * hand-rolls escaping here. Element names come from the per-type descriptors
 * (the box `xmlElement` field), so the descriptor remains the single source of
 * truth tying box key → CRA XML element. Amounts are emitted with `money2`
 * (fixed-2 dollar strings); identity/text fields are XML-escaped.
 *
 * This module is PURE and does no I/O. SIN/BN are passed in already-decrypted by
 * the authorized caller (`filing.ts`) and are never logged or persisted here.
 * The output mirrors the CRA slip/summary element grouping closely enough to
 * pass the committed XSDs (when present) — when the XSDs are absent, `filing.ts`
 * degrades the schema gate to a warning rather than blocking.
 */

const AMP = /&/g
const LT = /</g
const GT = />/g
const QUOT = /"/g
const APOS = /'/g

/** XML-escape a text value for element content / attribute use. */
export function escapeXml(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(AMP, '&amp;')
    .replace(LT, '&lt;')
    .replace(GT, '&gt;')
    .replace(QUOT, '&quot;')
    .replace(APOS, '&apos;')
}

/** A single `<NAME>value</NAME>` element; empty/blank values are omitted. */
export function el(name: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  return `<${name}>${escapeXml(value)}</${name}>`
}

/** A money element using the descriptor's fixed-2 dollar format. */
export function moneyEl(name: string, value: number | undefined | null): string {
  if (value === null || value === undefined) return ''
  return `<${name}>${money2(Number(value))}</${name}>`
}

/** Wrap children in `<NAME>…</NAME>`, dropping empty children. */
export function wrap(name: string, children: string[]): string {
  return `<${name}>${children.filter(Boolean).join('')}</${name}>`
}

/** Effective box value = override ?? computed. */
function boxValue(
  boxes: Record<string, number> | null | undefined,
  override: Record<string, number> | null | undefined,
  key: string
): number | undefined {
  const o = override?.[key]
  if (o !== null && o !== undefined) return Number(o)
  const b = boxes?.[key]
  return b === null || b === undefined ? undefined : Number(b)
}

export interface SlipXmlInput {
  /** decrypted SIN digits, or null for a business recipient. */
  sin: string | null
  /** recipient business number, or null for an individual. */
  recipientBn: string | null
  recipientName: string
  recipientAddress: string
  boxes: Record<string, number> | null | undefined
  boxesOverride: Record<string, number> | null | undefined
  reportCode: string
  slipNumber: string | null
}

export interface FilerXmlInput {
  legalName: string
  businessNumber: string
  rzAccount: string
  address: string
  transmitterNumber: string
  taxYear: number
}

/** Descriptor lookup for the two slip types we emit. */
function boxesForType(type: string): BoxDescriptor[] {
  if (type === 'T5') return T5_BOXES
  if (type === 'T4A') return T4A_BOXES
  return []
}

/**
 * Serialize one recipient slip. The recipient identity block uses SIN xor BN
 * (validated upstream); only descriptor-known boxes are emitted, in descriptor
 * order, so the XML element set always matches the box→element contract.
 */
export function serializeSlip(type: string, slip: SlipXmlInput): string {
  const descriptors = boxesForType(type)
  const amounts = descriptors
    .map((d) => moneyEl(d.xmlElement, boxValue(slip.boxes, slip.boxesOverride, d.key)))
    .filter(Boolean)

  const identity: string[] = []
  if (slip.sin) identity.push(el('sin', slip.sin))
  if (slip.recipientBn) identity.push(el('bn', slip.recipientBn))
  identity.push(el('rcpnt_nm', slip.recipientName))
  identity.push(el('rcpnt_addr', slip.recipientAddress))

  return wrap(`${type}Slip`, [
    el('rpt_tcd', slip.reportCode),
    el('slip_nbr', slip.slipNumber),
    wrap('RECIPIENT', identity),
    wrap('AMOUNTS', amounts),
  ])
}

/** Serialize the filer (transmitter/issuer) identity block. */
export function serializeFiler(filer: FilerXmlInput): string {
  return wrap('FILER', [
    el('filer_nm', filer.legalName),
    el('bn', filer.businessNumber),
    el('rz_account', filer.rzAccount),
    el('filer_addr', filer.address),
    el('transmitter_nbr', filer.transmitterNumber),
    el('tx_yr', filer.taxYear),
  ])
}

/**
 * Serialize a full return: filer + summary totals + all recipient slips.
 * `summaryTotals` is the descriptor-keyed sum across effective slips; element
 * names reuse the slip descriptors (totals share the box→element mapping).
 */
export function serializeReturn(
  type: string,
  filer: FilerXmlInput,
  slips: SlipXmlInput[],
  summaryTotals: Record<string, number>
): string {
  const descriptors = boxesForType(type)
  const totalEls = descriptors
    .map((d) => moneyEl(`TOT_${d.xmlElement}`, summaryTotals[d.key]))
    .filter(Boolean)

  const body = wrap(`${type}Return`, [
    serializeFiler(filer),
    wrap('SUMMARY', [el('slip_cnt', slips.length), ...totalEls]),
    ...slips.map((s) => serializeSlip(type, s)),
  ])

  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}`
}
