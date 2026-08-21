export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { getPeriodLock } from '@/lib/periodLock'
import PeriodLockCard from '@/components/accounting/PeriodLockCard'

export const metadata: Metadata = { title: 'Accounting' }

export default async function AccountingPage() {
  const [accountCount, entryCount, bankAccounts, lock] = await Promise.all([
    prisma.gLAccount.count({ where: { isArchived: false } }),
    prisma.journalEntry.count({}),
    prisma.bankAccount.findMany({ include: { glAccount: true } }),
    getPeriodLock(),
  ])

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Accounting
        </h1>
        <button
          className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
        >
          Invite
        </button>
      </div>

      <h2 className="text-xl text-[#0075DD] mb-4">Here&apos;s how to get started with accounting</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
          <div className="w-10 h-10 bg-[#E3F0FF] rounded-full flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-[#0075DD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 10l2-4h14l2 4M5 10v10h14V10" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[#001B40] mb-1">Get ready for bookkeeping</h3>
          <p className="text-sm text-[#576981] mb-3">
            Connect your bank or upload a CSV file to create related accounts in your books.
          </p>
          <button className="text-sm text-[#0075DD] hover:underline">Learn More</button>
        </div>

        <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
          <div className="w-10 h-10 bg-[#E3F0FF] rounded-full flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-[#0075DD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[#001B40] mb-1">Journal Entries and Chart of Accounts</h3>
          <p className="text-sm text-[#576981] mb-3">
            Create Journal Entries and edit accounts in the Chart of Accounts with Advanced Accounting.
          </p>
          <Link href="/accounting/journal-entries" className="text-sm text-[#0075DD] hover:underline">
            Journal Entries
          </Link>
          <span className="text-[#576981] mx-2">·</span>
          <Link href="/accounting/chart-of-accounts" className="text-sm text-[#0075DD] hover:underline">
            Chart of Accounts
          </Link>
        </div>

        <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
          <div className="w-10 h-10 bg-[#E3F0FF] rounded-full flex items-center justify-center mb-3">
            <svg className="w-5 h-5 text-[#0075DD]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-[#001B40] mb-1">Reconcile your accounts</h3>
          <p className="text-sm text-[#576981] mb-3">
            Match transactions to keep your books organized and accurate.
          </p>
          <button className="text-sm text-[#0075DD] hover:underline">Learn about Bank Reconciliation</button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <h2 className="text-base font-semibold text-[#001B40]">Bank Reconciliation</h2>
          <div className="flex items-center gap-3 flex-wrap">
            <button className="text-sm text-[#0075DD] hover:underline">Manage Bank Connections</button>
            <button className="px-4 py-1.5 text-sm bg-[#038A06] hover:bg-[#026e05] text-white rounded">
              Add Bank Account
            </button>
          </div>
        </div>
        {bankAccounts.length === 0 ? (
          <p className="text-sm text-[#576981]">
            Your bank accounts are disconnected or not available for Bank Reconciliation.{' '}
            <button className="text-[#0075DD] hover:underline">Connect your bank</button> to reconcile
            new transactions.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-5 sm:mx-0 px-5 sm:px-0">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-[#E1E6EB]">
                <th className="py-1 text-left text-xs font-semibold text-[#576981]">Your Bank Accounts</th>
                <th className="py-1 text-left text-xs font-semibold text-[#576981]">Transactions</th>
                <th className="py-1 text-right text-xs font-semibold text-[#576981]">Bank Balance</th>
                <th className="py-1 text-right text-xs font-semibold text-[#576981]">Books Balance</th>
              </tr>
            </thead>
            <tbody>
              {bankAccounts.map((b) => (
                <tr key={b.id} className="border-b border-[#E1E6EB]">
                  <td className="py-1 text-sm text-[#001B40]">{b.bankName}</td>
                  <td className="py-1 text-sm text-[#576981]">0 pending</td>
                  <td className="py-1 text-sm text-right">
                    {formatCurrency(Number(b.reconciledBalance), b.glAccount.currency)}
                  </td>
                  <td className="py-1 text-sm text-right">
                    {formatCurrency(Number(b.glAccount.currentBalance), b.glAccount.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      <h2 className="text-xl text-[#0075DD] mb-4">Period close</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <PeriodLockCard
          initialLockedThrough={lock.lockedThrough?.toISOString() ?? null}
          initialLockedAt={lock.lockedAt?.toISOString() ?? null}
          initialNotes={lock.notes}
        />
        <div className="space-y-3">
          <Link
            href="/accounting/migrate"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">Opening balance migration</h3>
            <p className="text-xs text-[#576981] mt-1">
              Bring in the trial balance from your previous accounting system and post the opening JE.
            </p>
          </Link>
          <Link
            href="/accounting/sales-tax"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">GST/HST filing</h3>
            <p className="text-xs text-[#576981] mt-1">
              Compute GST collected − ITCs for a period, mark filed, and post the remittance JE.
            </p>
          </Link>
          <Link
            href="/accounting/recurring"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">Recurring transactions</h3>
            <p className="text-xs text-[#576981] mt-1">
              Templates that auto-create or remind you about recurring invoices, bills, and expenses.
            </p>
          </Link>
          <Link
            href="/accounting/audit-log"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">Audit log</h3>
            <p className="text-xs text-[#576981] mt-1">
              Who did what and when — every create, edit, post, categorize, reconcile.
            </p>
          </Link>
          <Link
            href="/accounting/fx-revaluation"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">FX revaluation</h3>
            <p className="text-xs text-[#576981] mt-1">
              Post unrealized currency gains/losses on USD, EUR, etc. accounts at month-end.
            </p>
          </Link>
          <Link
            href="/accounting/year-end-close"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">Year-end close</h3>
            <p className="text-xs text-[#576981] mt-1">
              Roll net income into Retained Earnings, post the closing entries, and lock the fiscal year.
            </p>
          </Link>
          <Link
            href="/accounting/cca"
            className="block bg-white rounded-lg border border-[#E1E6EB] p-4 hover:border-[#0075DD] transition-colors"
          >
            <h3 className="text-base font-semibold text-[#001B40]">Capital cost allowance</h3>
            <p className="text-xs text-[#576981] mt-1">
              Declining-balance depreciation (CRA Schedule 8) with the half-year rule, rolling UCC, and
              the annual CCA journal entry at year-end.
            </p>
          </Link>
        </div>
      </div>

      <h2 className="text-xl text-[#0075DD] mb-4">Accounting Reports</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link
          href="/reports/profit-and-loss"
          className="bg-white rounded-lg border border-[#E1E6EB] p-5 hover:shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs bg-[#E3FCEF] text-[#006644] px-2 py-0.5 rounded font-semibold">UPDATED</span>
            <h3 className="text-base font-semibold text-[#001B40]">Profit and Loss</h3>
          </div>
          <p className="text-sm text-[#576981]">
            A summary of your total income, expenses, and net profit.
          </p>
        </Link>
        <Link
          href="/reports/general-ledger"
          className="bg-white rounded-lg border border-[#E1E6EB] p-5 hover:shadow-sm"
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs bg-[#E3FCEF] text-[#006644] px-2 py-0.5 rounded font-semibold">UPDATED</span>
            <h3 className="text-base font-semibold text-[#001B40]">General Ledger</h3>
          </div>
          <p className="text-sm text-[#576981]">
            A complete record of transactions and balances for all your accounts.
          </p>
        </Link>
        <Link
          href="/reports/balance-sheet"
          className="bg-white rounded-lg border border-[#E1E6EB] p-5 hover:shadow-sm"
        >
          <h3 className="text-base font-semibold text-[#001B40] mb-1">Balance Sheet</h3>
          <p className="text-sm text-[#576981]">Assets, Liabilities, and Equity summary.</p>
        </Link>
        <Link
          href="/reports/trial-balance"
          className="bg-white rounded-lg border border-[#E1E6EB] p-5 hover:shadow-sm"
        >
          <h3 className="text-base font-semibold text-[#001B40] mb-1">Trial Balance</h3>
          <p className="text-sm text-[#576981]">
            All accounts with debit and credit balances as of a point in time.
          </p>
        </Link>
      </div>

      <div className="flex items-center gap-4 text-sm text-[#576981]">
        <span>{accountCount} accounts</span>
        <span>·</span>
        <span>{entryCount} journal entries</span>
      </div>
    </div>
  )
}
