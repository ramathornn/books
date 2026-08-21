import 'server-only'
import Stripe from 'stripe'
import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto'
import { createJournalEntry, type JELine } from '@/lib/journalEntry'
import {
  buildStripeJournalLines,
  normalizeStripeAmounts,
  type StripeAccountMap,
} from '@/lib/stripePosting'

/**
 * Stripe revenue source — the live/poll sync layer that turns a connected
 * Stripe account's balance transactions into per-charge journal entries. It is
 * the DB + Stripe-SDK glue around the pure posting model in `stripePosting.ts`:
 * this file resolves the per-connection account map and the charge's billing
 * geography, then delegates the GL shape (and GST place-of-supply carve) to
 * `buildStripeJournalLines`, which is unit-tested in isolation.
 *
 * Each balance transaction posts a DRAFT JE keyed by
 * `JournalEntry.idempotencyKey = 'stripe:<balanceTxnId>'` (a @unique column), so
 * ingestion is exactly-once no matter how many times a poll re-reads the same
 * row. This is a READ-ONLY source: it uses the connection's stored restricted
 * key and never writes to Stripe. It is deliberately separate from the app's
 * own `lib/stripe.ts` payment-intent integration (full-access key, `/api/stripe`).
 */

const STRIPE_API_VERSION = '2026-03-25.dahlia'

/** The connection fields the sync layer needs (decrypted key resolved per call). */
export interface StripeConnectionLike {
  id: string
  secretKeyEnc: string
  revenueAccountId: string
  feeAccountId: string
  clearingAccountId: string
  gstPayableAccountId: string
  payoutDestinationAccountId: string
  gstTaxCodeId: string
  zeroRatedTaxCodeId: string
}

/** Build the posting account map from a stored connection's GL mapping. */
export function accountMapFromConnection(c: StripeConnectionLike): StripeAccountMap {
  return {
    revenue: c.revenueAccountId,
    fee: c.feeAccountId,
    clearing: c.clearingAccountId,
    gstPayable: c.gstPayableAccountId,
    payoutDestination: c.payoutDestinationAccountId,
    taxCodes: { gstIncome: c.gstTaxCodeId, zeroRated: c.zeroRatedTaxCodeId },
  }
}

/** A restricted read-only Stripe client built from the connection's encrypted key. */
export function stripeClientFor(c: Pick<StripeConnectionLike, 'secretKeyEnc'>): Stripe {
  return new Stripe(decryptSecret(c.secretKeyEnc), { apiVersion: STRIPE_API_VERSION })
}

interface Geo {
  country: string
  state: string
}

/**
 * Read the billing country/state off the charge behind a balance transaction.
 * `bt.source` is expanded by the caller (`expand: ['data.source']`). For a refund
 * the source is the refund object, whose original charge we retrieve to read the
 * billing address.
 */
async function resolveGeo(bt: Stripe.BalanceTransaction, stripe: Stripe): Promise<Geo | null> {
  const src = bt.source
  if (!src || typeof src === 'string') return null
  let charge: Stripe.Charge | null = null
  if (src.object === 'charge') {
    charge = src as Stripe.Charge
  } else if (src.object === 'refund') {
    const refund = src as Stripe.Refund
    const chId = typeof refund.charge === 'string' ? refund.charge : refund.charge?.id
    if (chId) charge = await stripe.charges.retrieve(chId)
  }
  const addr = charge?.billing_details?.address
  if (!addr || !addr.country) return null
  return { country: (addr.country || '').toUpperCase(), state: (addr.state || '').toUpperCase() }
}

function isIdempotencyCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = (e.meta as { target?: string[] | string } | undefined)?.target
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '')
  return fields.includes('idempotency_key') || fields.includes('idempotencyKey')
}

export type IngestStatus = 'created' | 'skipped' | 'unhandled' | 'non_cad'
export interface IngestResult {
  id: string
  type: string
  status: IngestStatus
  flag?: string
}

/**
 * Turn one Stripe balance transaction into a draft JE. Idempotent and safe to
 * call repeatedly. Non-CAD settlement rows and unknown types are left unbooked
 * and flagged rather than mis-posted into the CAD ledger.
 */
export async function ingestBalanceTransaction(
  bt: Stripe.BalanceTransaction,
  acc: StripeAccountMap,
  stripe: Stripe
): Promise<IngestResult> {
  const geo = await resolveGeo(bt, stripe)
  const result = buildStripeJournalLines(normalizeStripeAmounts(bt, geo), acc)

  if (result.status === 'non_cad') return { id: bt.id, type: bt.type, status: 'non_cad', flag: result.flag }
  if (result.status === 'unhandled') return { id: bt.id, type: bt.type, status: 'unhandled', flag: result.flag }

  const lines: JELine[] = result.lines
  const geoSuffix = geo ? ` ${geo.country}/${geo.state || '-'}` : ''
  const memo = `[stripe:${bt.id}] ${bt.type}${geoSuffix}${result.flag ? ` ⚠${result.flag}` : ''}`

  try {
    await createJournalEntry({
      entryDate: new Date(bt.created * 1000),
      description: `Stripe ${bt.type} ${bt.id}`,
      memo,
      status: 'draft',
      idempotencyKey: `stripe:${bt.id}`,
      lines,
    })
    return { id: bt.id, type: bt.type, status: 'created', flag: result.flag }
  } catch (e) {
    if (isIdempotencyCollision(e)) return { id: bt.id, type: bt.type, status: 'skipped' }
    throw e
  }
}

export interface ReconcileResult {
  scanned: number
  created: number
  skipped: number
  unhandled: number
  flagged: string[]
}

/**
 * Poll a connection's recent balance transactions and ingest each. Already-booked
 * rows return `skipped` via the unique idempotency key, so this is a safe no-op
 * for anything already caught and self-heals anything a missed live event dropped.
 * Default window: the last 30 days.
 */
export async function reconcileStripeConnection(
  connectionId: string,
  opts?: { sinceDays?: number; limit?: number }
): Promise<ReconcileResult> {
  const conn = await prisma.stripeConnection.findUnique({ where: { id: connectionId } })
  if (!conn) throw new Error('Stripe connection not found')
  if (conn.status === 'disconnected') throw new Error('Stripe connection is disconnected')

  const stripe = stripeClientFor(conn)
  const acc = accountMapFromConnection(conn)
  const result: ReconcileResult = { scanned: 0, created: 0, skipped: 0, unhandled: 0, flagged: [] }

  const sinceDays = opts?.sinceDays ?? 30
  const since = Math.floor((conn.lastSyncAt?.getTime() ?? Date.now() - sinceDays * 86_400_000) / 1000)
  const params: Stripe.BalanceTransactionListParams = {
    limit: opts?.limit ?? 100,
    expand: ['data.source'],
    created: { gte: since },
  }

  try {
    for await (const bt of stripe.balanceTransactions.list(params)) {
      result.scanned++
      const r = await ingestBalanceTransaction(bt, acc, stripe)
      if (r.status === 'created') result.created++
      else if (r.status === 'skipped') result.skipped++
      else result.unhandled++
      if (r.flag) result.flagged.push(`${bt.id} (${r.type}): ${r.flag}`)
    }
    await prisma.stripeConnection.update({
      where: { id: conn.id },
      data: { lastSyncAt: new Date(), status: 'active', lastError: null },
    })
    return result
  } catch (e) {
    await prisma.stripeConnection.update({
      where: { id: conn.id },
      data: { status: 'error', lastError: e instanceof Error ? e.message : String(e) },
    })
    throw e
  }
}
