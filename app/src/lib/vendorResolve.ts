/**
 * Vendor resolution for the bank-feed path: wrap the pure matcher (vendorMatch.ts)
 * with the Prisma loads + the guarded get-or-create + the learned-alias upsert.
 *
 * Two postures, deliberately separated:
 *   - suggestVendorForMerchant / suggestVendorForTx  → NEVER write. Used by the
 *     suggest-first HITL paths (import pre-fill, CategorizeDrawer) — they attach a
 *     vendor only on a confident match to an EXISTING vendor.
 *   - getOrCreateVendorForMerchant                    → the only path allowed to
 *     create a vendor, guarded by cleanVendor + normalised dedup. Used by the
 *     opt-in auto-post rules and by confirmed "create vendor X" picks.
 *
 * Does NOT import documentIntake (which carries `import 'server-only'`) so this
 * module stays reachable from the tsx scripts that go through captureCore.
 * ownOrgNames is passed in by the server-side callers instead.
 */
import prisma from '@/lib/prisma'
import { cleanVendor } from '@/lib/cleanVendor'
import {
  matchVendor,
  normalizeMerchant,
  type VendorLite,
  type VendorMatch,
} from '@/lib/vendorMatch'

export interface VendorIndex {
  vendors: VendorLite[]
  aliasIndex: Map<string, string>
}

/**
 * Load the active vendor list + the learned-alias index in two queries. Aliases
 * whose vendor is archived are dropped — otherwise the alias tier would resurrect
 * an archived vendor (and its name would no longer be pickable in the UI anyway).
 */
export async function loadVendorIndex(): Promise<VendorIndex> {
  const [vendors, aliases] = await Promise.all([
    prisma.vendor.findMany({ where: { isArchived: false }, select: { id: true, name: true } }),
    prisma.vendorAlias.findMany({
      select: { normalizedKey: true, vendorId: true, vendor: { select: { isArchived: true } } },
    }),
  ])
  const aliasIndex = new Map<string, string>()
  for (const a of aliases) {
    if (!a.vendor?.isArchived) aliasIndex.set(a.normalizedKey, a.vendorId)
  }
  return { vendors, aliasIndex }
}

/** Pure passthrough — resolve one merchant descriptor against a loaded index. */
export function suggestVendorForMerchant(
  merchant: string | null | undefined,
  index: VendorIndex
): VendorMatch {
  return matchVendor(merchant, index.vendors, index.aliasIndex)
}

/**
 * Resolve a transaction's vendor trying `payee` first, then `description` — a
 * non-matching payee must not shadow a matching description, so we only fall back
 * when the payee yields no confident vendor. Returns the payee's suggestion for
 * the "create vendor X" affordance when neither is confident.
 */
export function suggestVendorForTx(
  payee: string | null | undefined,
  description: string | null | undefined,
  index: VendorIndex
): VendorMatch {
  const first = suggestVendorForMerchant(payee, index)
  if (first.vendorId) return first
  const second = suggestVendorForMerchant(description, index)
  if (second.vendorId) return second
  // Neither confident — prefer a payee-derived suggestName, else the description's.
  const firstSuggest = 'suggestName' in first ? first.suggestName : null
  return firstSuggest ? first : second
}

export interface GetOrCreateOpts {
  /** Own-org names so cleanVendor rejects mailbox/workspace chrome echoing the company. */
  ownOrgNames?: string[]
  /** Optional canonical-name collapse (e.g. a caller-supplied canonicalVendorName). */
  canonicalize?: (name: string) => string
  /** Provenance stamped on the learned alias: "confirm" | "rule" | "auto". */
  source?: string
}

/**
 * Guarded get-or-create. The ONLY path allowed to create a vendor:
 *   cleanVendor (junk → null) → optional canonicalize → matchVendor
 *   → else case-insensitive findFirst → else create → learn the alias.
 * Returns the vendor id, or null when the merchant is junk.
 */
export async function getOrCreateVendorForMerchant(
  merchant: string | null | undefined,
  opts: GetOrCreateOpts = {}
): Promise<string | null> {
  const cleaned = cleanVendor(merchant, { ownOrgNames: opts.ownOrgNames })
  if (!cleaned) return null
  const canon = opts.canonicalize ? opts.canonicalize(cleaned) : cleaned

  const index = await loadVendorIndex()
  const m = matchVendor(canon, index.vendors, index.aliasIndex)
  if (m.vendorId) {
    // Already-known vendor: still learn the raw descriptor so the exact bank
    // string resolves via the (fastest) alias tier next time.
    await learnVendorAlias(merchant, m.vendorId, opts.source ?? 'auto')
    return m.vendorId
  }

  // Not confidently matched — get-or-create by canonical name. NO isArchived
  // filter: Vendor.name is @unique, so creating over an archived name throws;
  // reuse the existing row instead (matches captureCore.resolveVendorId).
  const found = await prisma.vendor.findFirst({
    where: { name: { equals: canon, mode: 'insensitive' } },
    select: { id: true },
  })
  const vendorId = found ? found.id : (await prisma.vendor.create({ data: { name: canon } })).id
  await learnVendorAlias(merchant, vendorId, opts.source ?? 'auto')
  return vendorId
}

/**
 * Remember that `merchant` (raw bank descriptor) is `vendorId`. Upsert on the
 * normalised key; on conflict the latest confirmation wins (a human correcting a
 * stale mapping should stick). No-op for keys shorter than 3 chars (too generic).
 */
export async function learnVendorAlias(
  merchant: string | null | undefined,
  vendorId: string,
  source: string
): Promise<void> {
  const normalizedKey = normalizeMerchant(merchant)
  if (normalizedKey.length < 3) return
  await prisma.vendorAlias.upsert({
    where: { normalizedKey },
    create: { normalizedKey, vendorId, source },
    update: { vendorId, source },
  })
}
