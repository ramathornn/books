import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { voidJournalEntry } from '@/lib/journalEntry'
import { assertNotReconLocked } from '@/lib/reconLock'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const tx = await prisma.bankTransaction.findUnique({ where: { id } })
  if (!tx) return Response.json({ error: 'Not found' }, { status: 404 })
  if (tx.status !== 'posted') return Response.json({ error: 'Not posted' }, { status: 400 })

  // Month-end reconciliation lock: can't unpost a tx in a locked month. For a
  // paired transfer, both sides are reverted together — check both accounts.
  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
    if (tx.transferPairId) {
      const pair = await prisma.bankTransaction.findMany({ where: { transferPairId: tx.transferPairId } })
      for (const p of pair) await assertNotReconLocked(p.bankAccountId, p.transactionDate)
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 423 })
  }

  // Void the linked JE if any. Per Wave 1 accrual spec §2 Phase 4 we must NOT
  // swallow a reversal failure: if the GL reversal throws (e.g. PERIOD_LOCKED),
  // bail out with a 5xx and leave journalEntryId intact so we never end up with
  // a one-sided revert (bank tx flipped to pending but the JE still on the books).
  if (tx.journalEntryId) {
    try {
      await voidJournalEntry(tx.journalEntryId)
    } catch (e) {
      console.error('voidJournalEntry failed:', e)
      return Response.json({ error: 'Failed to reverse journal entry' }, { status: 500 })
    }
  }

  // If it was matched to an invoice via a payment, reverse that
  if (tx.matchedPaymentId) {
    const payment = await prisma.payment.findUnique({ where: { id: tx.matchedPaymentId }, include: { invoice: true } })
    if (payment && payment.invoice) {
      // Reverse the settlement Payment's own GL entry (DR Bank / CR A/R / FERG)
      // before we delete the payment. Same no-swallow rule as above.
      if (payment.journalEntryId) {
        try {
          await voidJournalEntry(payment.journalEntryId)
        } catch (e) {
          console.error('voidJournalEntry (payment) failed:', e)
          return Response.json({ error: 'Failed to reverse settlement journal entry' }, { status: 500 })
        }
      }
      const newPaid = Math.max(Number(payment.invoice.amountPaid) - Number(payment.amount), 0)
      const newDue = Number(payment.invoice.total) - newPaid
      const newStatus = newPaid <= 0 ? 'sent' : newDue <= 0.005 ? 'paid' : 'partial'
      // Decrement the invoice's running CAD A/R relief by what this payment relieved,
      // floored at 0 so we never drive it negative.
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
  if (tx.transferPairId) {
    await prisma.bankTransaction.updateMany({
      where: { transferPairId: tx.transferPairId },
      data: revertData,
    })
  } else {
    await prisma.bankTransaction.update({ where: { id }, data: revertData })
  }

  return Response.json({ ok: true })
}
