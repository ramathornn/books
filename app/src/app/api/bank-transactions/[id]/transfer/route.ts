import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { assertNotReconLocked } from '@/lib/reconLock'
import { pairTransfer, PairTransferError } from '@/lib/bankTransfer'

// Record a transfer between two of your own bank accounts.
//
// Pairing mode (preferred): pass `counterpartTransactionId` — the matching line
// in the OTHER account (an inflow paired with this outflow, or vice-versa). We
// post ONE journal entry (DR destination bank, CR source bank, both in CAD),
// mark BOTH bank lines posted, and link them with a shared transferPairId. When
// the two accounts are in different currencies the CAD spread is booked to the
// Foreign Exchange Gain/Loss account so the entry balances. The pairing logic
// lives in src/lib/bankTransfer.ts (pairTransfer).
//
// Legacy mode: pass `otherBankAccountId` (a GL account id) to post only this
// side as a two-line transfer (kept for backward compatibility).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const memo = String(body.memo || '')

  // ---- Pairing mode ----
  const counterpartTransactionId = String(body.counterpartTransactionId || '')
  if (counterpartTransactionId) {
    try {
      const { journalEntryId, transferPairId, fxDifference } = await pairTransfer({
        txId: id,
        counterpartTxId: counterpartTransactionId,
        memo,
        explicitRate: body.explicitRate != null ? Number(body.explicitRate) : undefined,
        fxGlAccountId: body.fxGlAccountId ? String(body.fxGlAccountId) : undefined,
      })
      return Response.json({ ok: true, journalEntryId, transferPairId, fxDifference })
    } catch (e) {
      if (e instanceof PairTransferError) {
        return Response.json({ error: e.message }, { status: e.status })
      }
      throw e
    }
  }

  // ---- Legacy single-side mode ----
  const tx = await prisma.bankTransaction.findUnique({
    where: { id },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!tx) return Response.json({ error: 'Bank transaction not found' }, { status: 404 })
  if (tx.status === 'posted') return Response.json({ error: 'Already posted' }, { status: 400 })

  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 423 })
  }

  const otherBankAccountId = String(body.otherBankAccountId || '')
  if (!otherBankAccountId) {
    return Response.json(
      { error: 'counterpartTransactionId or otherBankAccountId required' },
      { status: 400 }
    )
  }

  const fromAccount = tx.bankAccount.glAccount
  const toAccount = await prisma.gLAccount.findUnique({ where: { id: otherBankAccountId } })
  if (!toAccount) return Response.json({ error: 'Destination account not found' }, { status: 400 })

  const isOut = Number(tx.amount) < 0
  const abs = Math.abs(Number(tx.amount))

  // For money-out: DR to-account, CR from-account (opposite for money-in)
  const lines = isOut
    ? [
        { glAccountId: toAccount.id, description: `Transfer to ${toAccount.accountName}`, debit: abs, credit: 0 },
        { glAccountId: fromAccount.id, description: `Transfer to ${toAccount.accountName}`, debit: 0, credit: abs },
      ]
    : [
        { glAccountId: fromAccount.id, description: `Transfer from ${toAccount.accountName}`, debit: abs, credit: 0 },
        { glAccountId: toAccount.id, description: `Transfer from ${toAccount.accountName}`, debit: 0, credit: abs },
      ]

  const je = await createJournalEntry({
    entryDate: tx.transactionDate,
    description: `Transfer: ${tx.description.slice(0, 80)}`,
    memo: memo || '',
    status: 'posted',
    lines,
  })

  await prisma.bankTransaction.update({
    where: { id: tx.id },
    data: {
      status: 'posted',
      categoryGlAccountId: toAccount.id,
      memo: memo || tx.memo,
      journalEntryId: je.id,
    },
  })

  return Response.json({ ok: true, journalEntryId: je.id })
}
