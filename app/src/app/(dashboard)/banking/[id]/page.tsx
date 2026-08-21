export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import BankAccountTransactionsClient from './BankAccountTransactionsClient'
import ArchiveAccountButton from './ArchiveAccountButton'
import PlaidAccountControls from './PlaidAccountControls'

export default async function BankAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const account = await prisma.bankAccount.findUnique({
    where: { id },
    include: {
      glAccount: true,
      plaidItem: true,
      _count: { select: { transactions: true } },
    },
  })
  if (!account) return notFound()

  const allAccounts = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    include: { glAccount: true, _count: { select: { transactions: true } } },
    orderBy: [{ sortOrder: 'asc' }],
  })

  // Status counts for tabs
  const counts = await prisma.bankTransaction.groupBy({
    by: ['status'],
    where: { bankAccountId: id },
    _count: { _all: true },
  })
  const tabCounts = {
    pending: counts.find((c) => c.status === 'pending')?._count._all ?? 0,
    posted: counts.find((c) => c.status === 'posted')?._count._all ?? 0,
    excluded: counts.find((c) => c.status === 'excluded')?._count._all ?? 0,
  }

  const [glAccounts, vendors, categories, taxCodes, openInvoices, recentExpenses, clearedPayments] = await Promise.all([
    prisma.gLAccount.findMany({
      where: { isArchived: false, accountClass: { in: ['expense', 'income', 'liability', 'asset'] } },
      orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    }),
    prisma.vendor.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.expenseCategory.findMany({ where: { isArchived: false }, orderBy: [{ groupName: 'asc' }, { name: 'asc' }] }),
    prisma.taxCode.findMany({ where: { isArchived: false }, orderBy: { code: 'asc' } }),
    prisma.invoice.findMany({
      where: { status: { in: ['sent', 'viewed', 'partial', 'overdue'] } },
      include: { client: true },
      orderBy: { dateIssued: 'desc' },
    }),
    prisma.expense.findMany({
      where: { isArchived: false },
      orderBy: { date: 'desc' },
      take: 200,
    }),
    // Payments already cleared to undeposited funds (have a settlement JE + CAD
    // basis) in this account's currency. A real bank deposit can move these from
    // clearing to the bank account. We exclude ones already matched to a posted
    // deposit below (matchedPaymentId is a bare scalar FK with no Prisma relation,
    // so the filter is applied in JS).
    prisma.payment.findMany({
      where: {
        currency: account.glAccount.currency,
        journalEntryId: { not: null },
        cadAmount: { not: null },
      },
      include: { invoice: { select: { invoiceNumber: true } }, client: true },
      orderBy: { paymentDate: 'desc' },
      take: 300,
    }),
  ])

  // Drop cleared payments that a posted bank deposit already cleared.
  const matchedPaymentIds = new Set(
    (
      await prisma.bankTransaction.findMany({
        where: { status: 'posted', matchedPaymentId: { in: clearedPayments.map((p) => p.id) } },
        select: { matchedPaymentId: true },
      })
    )
      .map((t) => t.matchedPaymentId)
      .filter((x): x is string => !!x)
  )
  const unmatchedClearedPayments = clearedPayments.filter((p) => !matchedPaymentIds.has(p.id))

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-2 text-sm">
        <Link href="/banking" className="text-[#0075DD] hover:underline">
          ← Banking
        </Link>
        <div className="flex items-center gap-4">
          {account.plaidItemId && (
            <PlaidAccountControls
              bankAccountId={account.id}
              lastSyncAt={account.lastSyncAt ? account.lastSyncAt.toISOString() : null}
              itemStatus={account.plaidItem?.status || 'active'}
            />
          )}
          <ArchiveAccountButton
            accountId={account.id}
            accountName={account.glAccount.accountName}
            balance={Number(account.glAccount.currentBalance)}
            currency={account.glAccount.currency}
            isArchived={account.isArchived}
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            {account.glAccount.accountName}
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            {account.glAccount.accountNumber} · {account.bankName}
            {account.accountNumberMasked && ` · ••${account.accountNumberMasked}`} ·{' '}
            {account.glAccount.currency}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-[#576981] uppercase">Book Balance</div>
          <div className="text-2xl font-semibold text-[#001B40]">
            {formatCurrency(Number(account.glAccount.currentBalance), account.glAccount.currency, {
              includeCode: false,
            })}
          </div>
          {account.plaidCurrentBalance != null && (
            <div className="mt-1">
              <div className="text-xs text-[#576981] uppercase">Bank balance (Plaid)</div>
              <div className="text-sm font-semibold text-[#001B40]">
                {formatCurrency(Number(account.plaidCurrentBalance), account.glAccount.currency, {
                  includeCode: false,
                })}
                {Math.abs(Number(account.glAccount.currentBalance) - Number(account.plaidCurrentBalance)) >= 0.01 && (
                  <span className="ml-2 text-xs font-normal text-[#BF2600]">
                    off by{' '}
                    {formatCurrency(
                      Number(account.glAccount.currentBalance) - Number(account.plaidCurrentBalance),
                      account.glAccount.currency,
                      { includeCode: false }
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <BankAccountTransactionsClient
        currentAccount={{
          id: account.id,
          glAccountNumber: account.glAccount.accountNumber,
          glAccountName: account.glAccount.accountName,
          currency: account.glAccount.currency,
          accountType: account.accountType,
          bankBalance: Number(account.reconciledBalance),
          bookBalance: Number(account.glAccount.currentBalance),
          totalTransactions: account._count.transactions,
        }}
        allAccounts={allAccounts.map((a) => ({
          id: a.id,
          accountNumber: a.glAccount.accountNumber,
          accountName: a.glAccount.accountName,
          accountType: a.accountType,
          currency: a.glAccount.currency,
          bookBalance: Number(a.glAccount.currentBalance),
          bankBalance: Number(a.reconciledBalance),
          transactionCount: a._count.transactions,
        }))}
        tabCounts={tabCounts}
        glAccounts={glAccounts.map((g) => ({
          id: g.id,
          accountNumber: g.accountNumber,
          accountName: g.accountName,
          accountClass: g.accountClass,
          currency: g.currency,
        }))}
        vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          groupName: c.groupName,
          glAccountId: c.glAccountId,
        }))}
        taxCodes={taxCodes.map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          rate: Number(t.rate),
          appliesTo: t.appliesTo,
        }))}
        openInvoices={openInvoices.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          clientName:
            i.client.organization || `${i.client.firstName} ${i.client.lastName}`.trim(),
          dateIssued: i.dateIssued.toISOString(),
          total: Number(i.total),
          amountDue: Number(i.amountDue),
          currency: i.currency,
        }))}
        recentExpenses={recentExpenses.map((e) => ({
          id: e.id,
          date: e.date.toISOString(),
          description: e.description,
          total: Number(e.total),
          currency: e.currency,
        }))}
        clearedPayments={unmatchedClearedPayments.map((p) => ({
          id: p.id,
          invoiceNumber: p.invoice?.invoiceNumber ?? '',
          clientName: p.client.organization || `${p.client.firstName} ${p.client.lastName}`.trim(),
          paymentDate: p.paymentDate.toISOString(),
          amount: Number(p.amount),
          currency: p.currency,
          cadAmount: Number(p.cadAmount),
        }))}
      />
    </div>
  )
}
