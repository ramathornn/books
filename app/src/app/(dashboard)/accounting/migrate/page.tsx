export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import OpeningBalanceWizard from './OpeningBalanceWizard'

export const metadata: Metadata = { title: 'Opening Balance Migration' }

export default async function MigratePage() {
  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })

  // Find an Opening Balance Equity account (or fall back to Retained Earnings or any equity)
  const obeAccount =
    accounts.find((a) => a.accountName.toLowerCase().includes('opening balance equity')) ||
    accounts.find((a) => a.accountName.toLowerCase().includes('retained earnings')) ||
    accounts.find((a) => a.accountClass === 'equity')

  // Has an opening balance JE already been posted?
  const existingMigrationJE = await prisma.journalEntry.findFirst({
    where: { description: { contains: 'Opening balance', mode: 'insensitive' } },
    orderBy: { entryDate: 'desc' },
  })

  return (
    <div>
      <div className="mb-6">
        <div className="text-sm mb-2">
          <Link href="/accounting" className="text-[#0075DD] hover:underline">← Accounting</Link>
        </div>
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Opening Balance Migration
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Bring closing balances from your previous accounting system into this app as a single
          balanced journal entry. The contra account is{' '}
          {obeAccount ? (
            <strong>{obeAccount.accountNumber} {obeAccount.accountName}</strong>
          ) : (
            <strong>Opening Balance Equity</strong>
          )}.
        </p>
      </div>

      {existingMigrationJE && (
        <div className="mb-4 p-3 bg-[#FFF8E5] border border-[#FFAB00] rounded text-sm">
          <strong>Heads up:</strong> a journal entry described as &ldquo;Opening balance&rdquo; was already posted on{' '}
          {existingMigrationJE.entryDate.toISOString().slice(0, 10)} (entry {existingMigrationJE.entryNumber}).{' '}
          Posting another opening JE will double-count balances. Verify before continuing.
        </div>
      )}

      <OpeningBalanceWizard
        accounts={accounts.map((a) => ({
          id: a.id,
          accountNumber: a.accountNumber,
          accountName: a.accountName,
          accountClass: a.accountClass,
          currency: a.currency,
        }))}
        defaultContraAccountId={obeAccount?.id || ''}
      />
    </div>
  )
}
