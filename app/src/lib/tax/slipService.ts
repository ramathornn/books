import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import { maskSin } from '@/lib/tax/sin'
import type { SlipType } from '@/lib/tax/descriptors/registry'

/**
 * Slip-service helpers shared by the issue / amend / cancel / file routes for
 * every slip type. Pure of UI; pure of HTTP — the routes own auth + response.
 *
 *  - `allocateSlipNumber`  sequential per (type, taxYear), collision-safe retry
 *                          mirroring `allocateEntryNumber` in journalEntry.ts.
 *  - `buildRecipientSnapshot` freezes the recipient's name/SIN-cipher/BN/address
 *                          onto the slip at issue time, so historical slips never
 *                          read the live (possibly archived) TaxParty row.
 *  - `filerSnapshot`       the filer identity block for summaries / PDFs.
 */

/**
 * Allocate the next slip number for a (type, taxYear). Numbers are sequential
 * integers padded to 6 digits, unique within the (type, taxYear, amendmentSeq=0)
 * space. Amendments reuse the parent's number, so allocation only happens at the
 * draft→issued transition for a brand-new slip.
 *
 * Collision-safe: the caller wraps the create in a retry loop on P2002 against
 * the @@unique([type, taxYear, slipNumber, amendmentSeq]) constraint.
 */
export async function allocateSlipNumber(
  tx: Prisma.TransactionClient,
  type: SlipType,
  taxYear: number
): Promise<string> {
  const last = await tx.taxSlip.findFirst({
    where: { type, taxYear, slipNumber: { not: null } },
    orderBy: { slipNumber: 'desc' },
    select: { slipNumber: true },
  })
  const lastNum = last?.slipNumber ? parseInt(last.slipNumber, 10) || 0 : 0
  return String(lastNum + 1).padStart(6, '0')
}

export interface RecipientSnapshot {
  recipientNameSnapshot: string
  recipientSinCipher: string | null
  recipientBnSnapshot: string | null
  recipientAddressSnapshot: string
}

interface PartyForSnapshot {
  kind: string
  firstName: string
  lastName: string
  businessName: string
  sinCipher: string | null
  businessNumber: string | null
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
}

/** Single-line recipient display name from a party row. */
export function partyDisplayName(p: {
  kind: string
  firstName: string
  lastName: string
  businessName: string
}): string {
  if (p.kind === 'business' || (!p.firstName && !p.lastName && p.businessName)) {
    return p.businessName.trim() || '—'
  }
  return [p.firstName, p.lastName].map((s) => (s || '').trim()).filter(Boolean).join(' ') || '—'
}

/** Single-line address from a party row (skips empty parts). */
export function partyAddressLine(p: PartyForSnapshot): string {
  const cityLine = [p.city, [p.province, p.postalCode].filter(Boolean).join(' ').trim()]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ')
  return [p.addressLine1, p.addressLine2, cityLine, p.country]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ')
}

/** Freeze the recipient identity onto a slip at issue time. */
export function buildRecipientSnapshot(p: PartyForSnapshot): RecipientSnapshot {
  return {
    recipientNameSnapshot: partyDisplayName(p),
    recipientSinCipher: p.sinCipher ?? null,
    recipientBnSnapshot: p.businessNumber?.trim() || null,
    recipientAddressSnapshot: partyAddressLine(p),
  }
}

/** Masked recipient id for display: SIN ••• mask, else BN, else "—". */
export function recipientIdMasked(s: {
  recipientSinCipher: string | null
  recipientBnSnapshot: string | null
  sinLast3?: string | null
}): string {
  if (s.sinLast3) return `•••-••-${s.sinLast3}`
  if (s.recipientSinCipher) return maskSin('') || '••• (SIN on file)'
  if (s.recipientBnSnapshot) return s.recipientBnSnapshot
  return '—'
}

/** Filer identity snapshot for summaries / PDFs. */
export async function filerSnapshot(): Promise<{
  legalName: string
  bnRz: string
  address: string
}> {
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  const company = await getCompanySettings()
  const bn = settings?.businessNumber?.trim() || ''
  const rz = settings?.rzAccountInfoReturns?.trim() || ''
  return {
    legalName: (company.legalName || company.name)?.trim() || '',
    bnRz: [bn, rz].filter(Boolean).join(' '),
    address: company.addressSingleLine || '',
  }
}
