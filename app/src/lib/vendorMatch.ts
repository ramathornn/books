/**
 * Pure vendor resolver: decide which existing Vendor a bank-feed merchant
 * descriptor belongs to, or that we should suggest creating a new one. No DB
 * access here — the caller loads the vendor list + learned-alias index and passes
 * them in, so this logic stays unit-testable and upstreamable (mirrors the
 * jeMatch.ts pure-core convention).
 *
 * Tiered, "never guess on ambiguity" (same rule as jeMatch.selectMatch):
 *   1. alias  — an exact learned mapping (normalised merchant key → vendor id).
 *   2. exact  — normalised-name equality.
 *   3. strong — a single vendor whose distinctive token appears in the descriptor.
 * More than one strong candidate → ambiguous (no auto-pick); none → suggest a
 * "create vendor X" using the cleaned descriptor (or nothing, if it's junk).
 */
import { vendorTokens } from '@/lib/jeMatch'
import { cleanVendor } from '@/lib/cleanVendor'

/**
 * Normalise a merchant descriptor to a stable key: lowercase, strip every
 * non-alphanumeric. Same shape as cleanVendor's private `norm`, redefined here
 * (it isn't exported) — this IS the VendorAlias.normalizedKey.
 */
export function normalizeMerchant(raw: string | null | undefined): string {
  return (raw || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export interface VendorLite {
  id: string
  name: string
}

export type VendorMatch =
  | { vendorId: string; confidence: 'alias' | 'exact' | 'strong' }
  | { vendorId: null; confidence: 'ambiguous' | 'none'; suggestName: string | null }

/**
 * Resolve a merchant descriptor against the known vendors + learned aliases.
 * `aliasIndex` maps normalised merchant key → vendor id (highest-confidence tier).
 */
export function matchVendor(
  merchant: string | null | undefined,
  vendors: VendorLite[],
  aliasIndex: Map<string, string>
): VendorMatch {
  const key = normalizeMerchant(merchant)

  // Tier 1 — learned alias (a human/rule already told us exactly what this is).
  if (key) {
    const aliasVendorId = aliasIndex.get(key)
    if (aliasVendorId) return { vendorId: aliasVendorId, confidence: 'alias' }
  }

  // Tier 2 — normalised-name equality (casing/punctuation-insensitive).
  if (key) {
    const exact = vendors.find((v) => normalizeMerchant(v.name) === key)
    if (exact) return { vendorId: exact.id, confidence: 'exact' }
  }

  // Tier 3 — distinctive-token containment. Test the descriptor both as-is and in
  // a space/punctuation-stripped ("squished") form, since bank descriptors split
  // brand names ("ANTHRO PIC" → "anthropic", "DNH*GODADDY" → "godaddy"). Tokens
  // come from the proper vendor NAME; a unique survivor wins, >1 is ambiguous.
  const text = (merchant || '').toLowerCase()
  const squished = text.replace(/[^a-z0-9]/g, '')
  const survivors = text
    ? vendors.filter((v) => {
        const tokens = vendorTokens(v.name)
        return tokens.some((t) => text.includes(t) || squished.includes(t))
      })
    : []
  if (survivors.length === 1) return { vendorId: survivors[0].id, confidence: 'strong' }

  // No confident single vendor — offer to create one from the cleaned descriptor
  // (null when cleanVendor rejects it as junk: email/mailbox/doc-type chrome).
  const suggestName = cleanVendor(merchant, {})
  return { vendorId: null, confidence: survivors.length > 1 ? 'ambiguous' : 'none', suggestName }
}
