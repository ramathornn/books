import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { voidJournalEntry } from '@/lib/journalEntry'
import { assertNotReconLocked } from '@/lib/reconLock'

// POST /api/banking/uncategorize — headless single-transaction reversal.
//
// Body (JSON):
//   transaction_id (string, required) — the POSTED bank transaction to revert
//
// Reverses the transaction's journal entry and returns the txn to `pending`,
// so it can be re-categorized cleanly. This is the bearer-auth headless twin of
// the UI's /api/bank-transactions/[id]/unpost route, and uses the SAME logic so
// there is no ledger drift: the GL reversal is dated at the original entry date
// (via reverseJournalEntry), paired transfers revert both legs, and a matched
// invoice payment is reversed before the txn is freed.
//
// Lock handling (respected like the other banking endpoints):
//   - Month-end reconciliation lock  -> 423 (assertNotReconLocked).
//   - Period lock (books locked-through) -> 423: voidJournalEntry re-dates the
//     reversal to the original entryDate, so assertNotLocked throws PERIOD_LOCKED
//     and we surface it instead of producing a one-sided revert.
//
// Idempotent: if the transaction is already pending (not posted), returns ok
// with a note instead of erroring, so re-runs over a batch are safe.
export async function POST(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { error: 'Expected JSON body with transaction_id' },
      { status: 400 }
    )
  }

  const transactionId = String(body.transaction_id || '').trim()
  if (!transactionId) {
    return Response.json({ error: 'transaction_id required' }, { status: 400 })
  }

  const tx = await prisma.bankTransaction.findUnique({ where: { id: transactionId } })
  if (!tx) {
    return Response.json({ error: 'Bank transaction not found' }, { status: 404 })
  }
  // Idempotency: only posted transactions have a JE to reverse. Anything already
  // pending (or excluded) is a no-op so a batch re-run never double-reverses.
  if (tx.status !== 'posted') {
    return Response.json({
      ok: true,
      status: tx.status,
      note: `Transaction is not posted (status: ${tx.status}); nothing to reverse.`,
    })
  }

  // Month-end reconciliation lock: can't revert a tx in a locked month. For a
  // paired transfer, both sides are reverted together — check both accounts.
  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
    if (tx.transferPairId) {
      const pair = await prisma.bankTransaction.findMany({
        where: { transferPairId: tx.transferPairId },
      })
      for (const p of pair) await assertNotReconLocked(p.bankAccountId, p.transactionDate)
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 423 })
  }

  // Void the linked JE. We must NOT swallow a reversal failure: if the GL
  // reversal throws we bail and leave journalEntryId intact, so we never end up
  // with a one-sided revert (txn flipped to pending but the JE still on the
  // books). A period lock surfaces as PERIOD_LOCKED -> 423; anything else -> 500.
  if (tx.journalEntryId) {
    try {
      await voidJournalEntry(tx.journalEntryId)
    } catch (e) {
      if ((e as { code?: string }).code === 'PERIOD_LOCKED') {
        return Response.json({ error: (e as Error).message }, { status: 423 })
      }
      console.error('voidJournalEntry failed:', e)
      return Response.json({ error: 'Failed to reverse journal entry' }, { status: 500 })
    }
  }

  // If it was matched to an invoice via a payment, reverse that settlement too.
  if (tx.matchedPaymentId) {
    const payment = await prisma.payment.findUnique({
      where: { id: tx.matchedPaymentId },
      include: { invoice: true },
    })
    // Only unwind payments this match CREATED (their JE is this tx's JE). A
    // pre-existing undeposited payment that was merely CLEARED to the bank (its
    // own settlement JE differs) must stay — voiding the tx's JE already moved
    // the cash back to clearing, leaving the invoice paid.
    if (payment && payment.invoice && payment.journalEntryId === tx.journalEntryId) {
      if (payment.journalEntryId) {
        try {
          await voidJournalEntry(payment.journalEntryId)
        } catch (e) {
          if ((e as { code?: string }).code === 'PERIOD_LOCKED') {
            return Response.json({ error: (e as Error).message }, { status: 423 })
          }
          console.error('voidJournalEntry (payment) failed:', e)
          return Response.json(
            { error: 'Failed to reverse settlement journal entry' },
            { status: 500 }
          )
        }
      }
      const newPaid = Math.max(Number(payment.invoice.amountPaid) - Number(payment.amount), 0)
      const newDue = Number(payment.invoice.total) - newPaid
      const newStatus = newPaid <= 0 ? 'sent' : newDue <= 0.005 ? 'paid' : 'partial'
      const reliefDelta = Number(payment.cadArRelief ?? 0)
      const newReliefToDate = Math.max(Number(payment.invoice.cadReliefToDate) - reliefDelta, 0)
      await prisma.invoice.update({
        where: { id: payment.invoice.id },
        data: { amountPaid: newPaid, amountDue: newDue, status: newStatus, cadReliefToDate: newReliefToDate },
      })
      await prisma.payment.delete({ where: { id: payment.id } })
    }
  }

  // Split match: a single settlement JE can carry MORE than one Payment (one per
  // invoice). The GL was already reversed by voidJournalEntry(tx.journalEntryId)
  // above; here we unwind every remaining Payment tied to that JE so each
  // invoice's amountPaid/status/relief is restored. (matchedPaymentId, handled
  // above, is excluded so it isn't double-processed.)
  if (tx.journalEntryId) {
    const extraPayments = await prisma.payment.findMany({
      where: { journalEntryId: tx.journalEntryId, id: { not: tx.matchedPaymentId ?? '' } },
      include: { invoice: true },
    })
    for (const payment of extraPayments) {
      if (!payment.invoice) continue
      const newPaid = Math.max(Number(payment.invoice.amountPaid) - Number(payment.amount), 0)
      const newDue = Number(payment.invoice.total) - newPaid
      const newStatus = newPaid <= 0 ? 'sent' : newDue <= 0.005 ? 'paid' : 'partial'
      const reliefDelta = Number(payment.cadArRelief ?? 0)
      const newReliefToDate = Math.max(Number(payment.invoice.cadReliefToDate) - reliefDelta, 0)
      await prisma.invoice.update({
        where: { id: payment.invoice.id },
        data: { amountPaid: newPaid, amountDue: newDue, status: newStatus, cadReliefToDate: newReliefToDate },
      })
      await prisma.payment.delete({ where: { id: payment.id } })
    }
  }

  const revertData = {
    status: 'pending',
    journalEntryId: null,
    transferPairId: null,
    matchedInvoiceId: null,
    matchedPaymentId: null,
    matchedExpenseId: null,
    categoryGlAccountId: null,
    isReconciled: false,
    reconciledAt: null,
  } as const

  // Paired transfer: both sides share one JE (already voided above), so revert
  // the counterpart too instead of leaving it stranded as "posted".
  let reverted = 1
  if (tx.transferPairId) {
    const res = await prisma.bankTransaction.updateMany({
      where: { transferPairId: tx.transferPairId },
      data: revertData,
    })
    reverted = res.count
  } else {
    await prisma.bankTransaction.update({ where: { id: transactionId }, data: revertData })
  }

  return Response.json({ ok: true, status: 'pending', reverted_count: reverted })
}
