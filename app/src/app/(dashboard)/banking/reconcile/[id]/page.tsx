export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import ReconcileWorkingClient from './ReconcileWorkingClient'

export default async function ReconcileSessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const sess = await prisma.reconciliationSession.findUnique({ where: { id } })
  if (!sess) return notFound()

  const account = await prisma.bankAccount.findUnique({
    where: { id: sess.bankAccountId },
    include: { glAccount: true },
  })
  if (!account) return notFound()

  const txs = await prisma.bankTransaction.findMany({
    where: {
      bankAccountId: sess.bankAccountId,
      status: 'posted',
      transactionDate: {
        gte: sess.statementStartDate,
        lte: sess.statementEndDate,
      },
    },
    orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
  })

  // Is this account already reconciliation-locked over the statement period?
  const existingLock = await prisma.reconciliationLock.findFirst({
    where: {
      bankAccountId: sess.bankAccountId,
      periodStart: { lte: sess.statementEndDate },
      periodEnd: { gte: sess.statementStartDate },
    },
  })

  return (
    <ReconcileWorkingClient
      session={{
        id: sess.id,
        bankAccountId: sess.bankAccountId,
        statementStartDate: sess.statementStartDate.toISOString(),
        statementEndDate: sess.statementEndDate.toISOString(),
        beginningBalance: Number(sess.beginningBalance),
        endingBalance: Number(sess.endingBalance),
        status: sess.status,
      }}
      lock={
        existingLock
          ? {
              id: existingLock.id,
              periodStart: existingLock.periodStart.toISOString(),
              periodEnd: existingLock.periodEnd.toISOString(),
            }
          : null
      }
      account={{
        id: account.id,
        accountNumber: account.glAccount.accountNumber,
        accountName: account.glAccount.accountName,
        currency: account.glAccount.currency,
        bookBalance: Number(account.glAccount.currentBalance),
      }}
      transactions={txs.map((t) => ({
        id: t.id,
        transactionDate: t.transactionDate.toISOString(),
        description: t.description,
        payee: t.payee,
        amount: Number(t.amount),
        reconciliationSessionId: t.reconciliationSessionId,
      }))}
    />
  )
}
