export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'

import prisma from '@/lib/prisma'
import { getDividendsDeclaredAccountId } from '@/lib/tax/declareDividend'
import { computeGripRoom } from '@/lib/tax/gripRoom'
import DeclareDividendClient, { type CreditAccount } from './DeclareDividendClient'

export const metadata: Metadata = { title: 'Declare Dividend' }

/**
 * "Declare dividend" flow (T5, locked decision). Posts DR 3300 Dividends
 * Declared / CR <credit account>; the T5 auto-pull then sums posted JE debits to
 * the Dividends Declared account for the year. The page surfaces the configured
 * account and the candidate credit accounts.
 */
export default async function DeclareDividendPage() {
  const dividendsDeclaredAccountId = await getDividendsDeclaredAccountId()

  const dividendsDeclaredAccount = dividendsDeclaredAccountId
    ? await prisma.gLAccount.findUnique({
        where: { id: dividendsDeclaredAccountId },
        select: { accountNumber: true, accountName: true },
      })
    : null

  const creditCandidates = dividendsDeclaredAccountId
    ? await prisma.gLAccount.findMany({
        where: { isArchived: false, accountClass: { in: ['liability', 'asset'] } },
        select: { id: true, accountNumber: true, accountName: true, accountClass: true },
        orderBy: { accountNumber: 'asc' },
      })
    : []

  // Live GRIP room — the ceiling for an eligible designation (BLOCKER 3). $0 for
  // the active-income-only persona with no prior prepared T2.
  const gripRoom = dividendsDeclaredAccountId
    ? await computeGripRoom({ declaredDate: new Date(), dividendsDeclaredAccountId })
    : null

  return (
    <div className="max-w-2xl">
      <div className="text-sm mb-2">
        <Link href="/tax" className="text-[#0075DD] hover:underline">
          ← Tax
        </Link>
      </div>
      <h1
        className="text-[28px] sm:text-[40px] font-medium text-[#001B40] mb-1"
        style={{ fontFamily: 'var(--font-heading)' }}
      >
        Declare a dividend
      </h1>
      <p className="text-sm text-[#576981] mb-6">
        Posts a journal entry to <span className="font-medium">Dividends Declared</span>, the source the T5
        slip auto-pulls from.
      </p>

      {!dividendsDeclaredAccountId ? (
        <div className="rounded-lg border border-[#F3D9A8] bg-[#FFF8E8] p-4 text-sm text-[#8A6D1B]">
          The <span className="font-medium">Dividends Declared</span> account is not configured. Run
          <code className="mx-1 rounded bg-white px-1 py-0.5">scripts/ensure-tax-accounts.ts</code> to create
          account 3300 and wire it.
        </div>
      ) : (
        <DeclareDividendClient
          dividendsDeclaredLabel={
            dividendsDeclaredAccount
              ? `${dividendsDeclaredAccount.accountNumber} ${dividendsDeclaredAccount.accountName}`
              : 'Dividends Declared'
          }
          creditAccounts={creditCandidates as CreditAccount[]}
          gripRoomRemaining={gripRoom?.roomRemaining ?? 0}
        />
      )}
    </div>
  )
}
