export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import StartReconciliationForm from './StartReconciliationForm'

export const metadata: Metadata = { title: 'Reconcile' }

export default async function ReconcilePage() {
  const accounts = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    include: { glAccount: true },
    orderBy: [{ sortOrder: 'asc' }],
  })

  const inProgress = await prisma.reconciliationSession.findMany({
    where: { status: 'in_progress' },
    orderBy: { createdAt: 'desc' },
  })

  const completed = await prisma.reconciliationSession.findMany({
    where: { status: 'completed' },
    orderBy: { completedAt: 'desc' },
    take: 30,
  })

  const accountLookup = new Map(accounts.map((a) => [a.id, a]))

  return (
    <div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Reconcile
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Match the books to your bank statement. Pick an account, enter the statement&apos;s closing balance, then tick off cleared lines until the difference hits zero.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        <div>
          <StartReconciliationForm
            accounts={accounts.map((a) => ({
              id: a.id,
              accountNumber: a.glAccount.accountNumber,
              accountName: a.glAccount.accountName,
              currency: a.glAccount.currency,
              bookBalance: Number(a.glAccount.currentBalance),
              reconciledBalance: Number(a.reconciledBalance),
              lastReconciledAt: a.lastReconciledAt ? a.lastReconciledAt.toISOString() : null,
            }))}
          />

          {inProgress.length > 0 && (
            <div className="mt-6 bg-white rounded-lg border border-[#FFAB00] p-4">
              <h2 className="text-sm font-semibold text-[#001B40] mb-2">In progress</h2>
              <ul className="space-y-2">
                {inProgress.map((s) => {
                  const acct = accountLookup.get(s.bankAccountId)
                  if (!acct) return null
                  return (
                    <li key={s.id} className="flex items-center justify-between text-sm">
                      <div>
                        <Link
                          href={`/banking/reconcile/${s.id}`}
                          className="text-[#0075DD] hover:underline font-medium"
                        >
                          {acct.glAccount.accountNumber} {acct.glAccount.accountName}
                        </Link>
                        <span className="text-[#576981] ml-2">
                          ending {s.statementEndDate.toISOString().slice(0, 10)} ·{' '}
                          {formatCurrency(Number(s.endingBalance), acct.glAccount.currency, {
                            includeCode: false,
                          })}
                        </span>
                      </div>
                      <Link
                        href={`/banking/reconcile/${s.id}`}
                        className="px-3 py-1 text-xs font-medium text-white bg-[#0075DD] hover:bg-[#005FB3] rounded"
                      >
                        Resume
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

        <div>
          <div className="bg-white rounded-lg border border-[#E1E6EB]">
            <div className="px-4 py-3 border-b border-[#E1E6EB]">
              <h3 className="text-sm font-semibold text-[#001B40]">Recent reconciliations</h3>
            </div>
            {completed.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#576981]">
                None yet.
              </div>
            ) : (
              <ul className="divide-y divide-[#E1E6EB]">
                {completed.map((s) => {
                  const acct = accountLookup.get(s.bankAccountId)
                  return (
                    <li key={s.id} className="px-4 py-2.5 text-sm">
                      <div className="font-medium text-[#001B40] truncate">
                        {acct ? `${acct.glAccount.accountNumber} ${acct.glAccount.accountName}` : '—'}
                      </div>
                      <div className="text-xs text-[#576981]">
                        Ended {s.statementEndDate.toISOString().slice(0, 10)} ·{' '}
                        {formatCurrency(Number(s.endingBalance), acct?.glAccount.currency || 'CAD', {
                          includeCode: false,
                        })}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
