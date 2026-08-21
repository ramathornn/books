export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import BankingActions from './BankingActions'
import BankingViewClient from './BankingViewClient'
import ArchivedAccountsList from './ArchivedAccountsList'
// import PlaidConnect from './PlaidConnect' // hidden — using CSV import (RBC/Wise not Plaid-connectable)

export const metadata: Metadata = { title: 'Banking' }

export default async function BankingPage() {
  // Read the saved view from a cookie so the server renders the correct view on
  // first paint (no tile→table flicker when the user's preset is "table").
  const initialView: 'tile' | 'table' =
    (await cookies()).get('banking-view-mode')?.value === 'table' ? 'table' : 'tile'

  const accounts = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    include: {
      glAccount: true,
      _count: { select: { transactions: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { bankName: 'asc' }],
  })

  const archivedAccounts = await prisma.bankAccount.findMany({
    where: { isArchived: true },
    include: { glAccount: true },
    orderBy: [{ sortOrder: 'asc' }, { bankName: 'asc' }],
  })

  const totalAccounts = accounts.length

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Banking
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            {totalAccounts} {totalAccounts === 1 ? 'account' : 'accounts'} connected. Click an account to import a CSV or review transactions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/banking/rules"
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
          >
            Rules
          </Link>
          <Link
            href="/banking/reconcile"
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
          >
            Reconcile
          </Link>
          {/* Plaid connect hidden — RBC/Wise aren't connectable via Plaid (MFA/unsupported); using CSV import instead. Restore by uncommenting this and the import above.
          <PlaidConnect
            bankAccounts={accounts.map((a) => ({
              id: a.id,
              accountNumber: a.glAccount.accountNumber,
              accountName: a.glAccount.accountName,
              currency: a.glAccount.currency,
              mask: a.accountNumberMasked,
            }))}
          />
          */}
          <BankingActions />
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="bg-white rounded-lg border border-[#E1E6EB] p-12 text-center">
          <p className="text-sm text-[#576981] mb-4">No bank accounts yet.</p>
          <p className="text-xs text-[#8C9BAB]">
            Bank accounts are auto-created from Bank-typed entries in your Chart of Accounts.
          </p>
        </div>
      ) : (
        <BankingViewClient
          initialView={initialView}
          accounts={accounts.map((a) => ({
            id: a.id,
            glAccountNumber: a.glAccount.accountNumber,
            glAccountName: a.glAccount.accountName,
            bankName: a.bankName,
            accountNumberMasked: a.accountNumberMasked,
            accountType: a.accountType,
            currency: a.glAccount.currency,
            bookBalance: Number(a.glAccount.currentBalance),
            reconciledBalance: Number(a.reconciledBalance),
            transactionCount: a._count.transactions,
            lastReconciledAt: a.lastReconciledAt ? a.lastReconciledAt.toISOString() : null,
            isLinked: !!a.plaidItemId,
            plaidCurrentBalance: a.plaidCurrentBalance != null ? Number(a.plaidCurrentBalance) : null,
          }))}
        />
      )}

      <ArchivedAccountsList
        accounts={archivedAccounts.map((a) => ({
          id: a.id,
          accountNumber: a.glAccount.accountNumber,
          accountName: a.glAccount.accountName,
          currency: a.glAccount.currency,
        }))}
      />
    </div>
  )
}
