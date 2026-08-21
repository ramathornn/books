import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { assertNotReconLocked } from '@/lib/reconLock'
import { findRealizedFxAccount } from '@/lib/fxAccounts'
import { convertToCad, getCadRate } from '@/lib/fx'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Error thrown by {@link pairTransfer}. Carries an HTTP-ish `status` so callers
 * (the UI route) can preserve their existing response codes verbatim:
 *   400 — bad request / validation
 *   404 — the primary transaction was not found
 *   423 — a reconciliation lock blocks the post
 */
export class PairTransferError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'PairTransferError'
  }
}

export interface PairTransferInput {
  /** The bank transaction the user acted on (this side of the pairing). */
  txId: string
  /** The matching line in the OTHER account (opposite sign). */
  counterpartTxId: string
  /** Optional memo to stamp on both legs / the JE. */
  memo?: string
  /**
   * Explicit CAD-per-unit rate for the FOREIGN leg of a cross-currency
   * transfer. When omitted, each foreign leg is converted at its own
   * transactionDate BoC rate via getCadRate().
   */
  explicitRate?: number
  /** Override GL account id for the realized FX (499) line. */
  fxGlAccountId?: string
}

export interface PairTransferResult {
  journalEntryId: string
  transferPairId: string
  /** round2(dstCad - srcCad); booked to 499 when |.| > 0.005. */
  fxDifference: number
}

/**
 * Pair two of your own bank lines (one outflow + one inflow, opposite signs)
 * into a single transfer journal entry, mark BOTH lines posted, and link them
 * with a shared transferPairId.
 *
 * The JE posts CAD-CONVERTED amounts so cross-currency transfers balance:
 *   DR destination bank = dstCad
 *   CR source bank      = srcCad
 * where each leg's CAD = nativeAmount × rate (rate = 1 for CAD legs; for a
 * foreign leg use `explicitRate` if given, else the BoC rate at its txn date).
 * realizedFx = round2(dstCad − srcCad) → 499 (gain CR / loss DR), so the entry
 * balances. Same-currency CAD transfers are unchanged (dstCad === dstAmt).
 */
export async function pairTransfer(input: PairTransferInput): Promise<PairTransferResult> {
  const { txId, counterpartTxId } = input
  const memo = String(input.memo || '')

  const tx = await prisma.bankTransaction.findUnique({
    where: { id: txId },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!tx) throw new PairTransferError('Bank transaction not found', 404)
  if (tx.status === 'posted') throw new PairTransferError('Already posted', 400)

  await assertReconUnlocked(tx.bankAccountId, tx.transactionDate)

  if (!counterpartTxId) {
    throw new PairTransferError('counterpartTransactionId required', 400)
  }
  if (counterpartTxId === tx.id) {
    throw new PairTransferError('Cannot pair a transaction with itself', 400)
  }

  const other = await prisma.bankTransaction.findUnique({
    where: { id: counterpartTxId },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!other) throw new PairTransferError('Counterpart transaction not found', 400)
  if (other.status !== 'pending') {
    throw new PairTransferError('Counterpart is not pending', 400)
  }
  if (other.bankAccountId === tx.bankAccountId) {
    throw new PairTransferError('Counterpart must be in a different account', 400)
  }
  await assertReconUnlocked(other.bankAccountId, other.transactionDate)

  const aOut = Number(tx.amount) < 0
  const bOut = Number(other.amount) < 0
  if (aOut === bOut) {
    throw new PairTransferError(
      'A transfer needs one outflow and one inflow (opposite signs).',
      400
    )
  }

  const source = aOut ? tx : other // the outflow
  const dest = aOut ? other : tx // the inflow
  const srcGl = source.bankAccount.glAccount
  const dstGl = dest.bankAccount.glAccount
  const srcAmt = Math.abs(Number(source.amount))
  const dstAmt = Math.abs(Number(dest.amount))

  // Convert EACH leg to CAD. A CAD leg is 1:1. A foreign leg uses the explicit
  // rate if supplied, otherwise its own transactionDate BoC rate. The realized
  // FX gain/loss is the CAD spread between what left the source and what landed
  // in the destination.
  const srcCad = await legToCad(srcAmt, srcGl.currency, source.transactionDate, input.explicitRate)
  const dstCad = await legToCad(dstAmt, dstGl.currency, dest.transactionDate, input.explicitRate)
  const realizedFx = round2(dstCad - srcCad)

  // Bank lines post CAD-CONVERTED amounts so the entry balances cross-currency.
  const lines = [
    { glAccountId: dstGl.id, description: `Transfer from ${srcGl.accountName}`, debit: dstCad, credit: 0 },
    { glAccountId: srcGl.id, description: `Transfer to ${dstGl.accountName}`, debit: 0, credit: srcCad },
  ]
  if (Math.abs(realizedFx) > 0.005) {
    let fx
    try {
      fx = await findRealizedFxAccount(input.fxGlAccountId ? String(input.fxGlAccountId) : undefined)
    } catch (err) {
      throw new PairTransferError(
        err instanceof Error ? err.message : 'No realized FX account (499) found in the chart.',
        400
      )
    }
    // 499 is income/credit-normal: a realized gain CREDITs it, a loss DEBITs it.
    if (realizedFx > 0) {
      lines.push({ glAccountId: fx.id, description: 'Realized FX gain on transfer', debit: 0, credit: realizedFx })
    } else {
      lines.push({ glAccountId: fx.id, description: 'Realized FX loss on transfer', debit: -realizedFx, credit: 0 })
    }
  }

  // Stamp the per-leg CAD rate used for each side into the memo for audit.
  const [srcRate, dstRate] = await Promise.all([
    legRate(srcGl.currency, source.transactionDate, input.explicitRate),
    legRate(dstGl.currency, dest.transactionDate, input.explicitRate),
  ])
  const fmtDate = (d: Date) => d.toISOString().slice(0, 10)
  const rateNote =
    `FX: ${srcGl.currency} @ ${srcRate.rate} (${fmtDate(srcRate.rateDate)}) → CAD ${srcCad}; ` +
    `${dstGl.currency} @ ${dstRate.rate} (${fmtDate(dstRate.rateDate)}) → CAD ${dstCad}`
  const jeMemo = Math.abs(realizedFx) > 0.005 || srcGl.currency !== dstGl.currency
    ? (memo ? `${memo} | ${rateNote}` : rateNote)
    : memo

  const je = await createJournalEntry({
    entryDate: source.transactionDate,
    description: `Transfer: ${srcGl.accountName} → ${dstGl.accountName}`,
    memo: jeMemo,
    status: 'posted',
    lines,
  })

  const transferPairId = crypto.randomUUID()
  await prisma.$transaction([
    prisma.bankTransaction.update({
      where: { id: source.id },
      data: {
        status: 'posted',
        journalEntryId: je.id,
        transferPairId,
        categoryGlAccountId: dstGl.id,
        memo: memo || source.memo,
      },
    }),
    prisma.bankTransaction.update({
      where: { id: dest.id },
      data: {
        status: 'posted',
        journalEntryId: je.id,
        transferPairId,
        categoryGlAccountId: srcGl.id,
        memo: memo || dest.memo,
      },
    }),
  ])

  return { journalEntryId: je.id, transferPairId, fxDifference: realizedFx }
}

/** Run assertNotReconLocked, re-wrapping its error as a 423 PairTransferError. */
async function assertReconUnlocked(bankAccountId: string, date: Date): Promise<void> {
  try {
    await assertNotReconLocked(bankAccountId, date)
  } catch (e) {
    throw new PairTransferError((e as Error).message, 423)
  }
}

/** CAD value of one leg: 1:1 for CAD; explicitRate (if given) or BoC rate for foreign. */
async function legToCad(
  amount: number,
  currency: string,
  date: Date,
  explicitRate?: number
): Promise<number> {
  if (currency.toUpperCase() === 'CAD') return round2(amount)
  if (typeof explicitRate === 'number' && Number.isFinite(explicitRate)) {
    return round2(amount * explicitRate)
  }
  return convertToCad(amount, currency, date)
}

/** Resolve the rate used for a leg's memo note, honoring explicitRate for foreign legs. */
async function legRate(
  currency: string,
  date: Date,
  explicitRate?: number
): Promise<{ rate: number; rateDate: Date }> {
  if (
    currency.toUpperCase() !== 'CAD' &&
    typeof explicitRate === 'number' &&
    Number.isFinite(explicitRate)
  ) {
    return { rate: explicitRate, rateDate: date }
  }
  const r = await getCadRate(currency, date)
  return { rate: r.rate, rateDate: r.rateDate }
}
