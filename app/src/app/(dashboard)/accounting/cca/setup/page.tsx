export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import CcaSetupClient from './CcaSetupClient'

export const metadata: Metadata = { title: 'CCA — Setup classes' }

export default async function CcaSetupPage() {
  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    select: { id: true, accountNumber: true, accountName: true, accountClass: true },
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting/cca" className="text-[#0075DD] hover:underline">← Capital Cost Allowance</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          CCA classes
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Define each CCA class, its declining-balance rate, the half-year / AccII treatment, and the
          GL accounts a claim posts to (depreciation expense, accumulated amortization, and the asset
          account). Common defaults: Class 8 @ 20%, Class 10 @ 30%, Class 50 @ 55%.
        </p>
      </div>

      <CcaSetupClient
        accounts={accounts.map((a) => ({
          id: a.id,
          label: `${a.accountNumber} · ${a.accountName}`,
          accountClass: a.accountClass,
        }))}
      />
    </div>
  )
}
