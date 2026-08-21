export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import RecurringClient from './RecurringClient'

export const metadata: Metadata = { title: 'Recurring Transactions' }

export default async function RecurringPage() {
  const templates = await prisma.recurringTemplate.findMany({
    orderBy: [{ isActive: 'desc' }, { nextRunDate: 'asc' }],
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting" className="text-[#0075DD] hover:underline">← Accounting</Link>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[28px] sm:text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
            Recurring Transactions
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            Templates that auto-create transactions on a schedule. Use Reminder mode to nag yourself, Auto-create to post automatically.
          </p>
        </div>
      </div>

      <RecurringClient
        initialTemplates={templates.map((t) => ({
          id: t.id,
          templateName: t.templateName,
          transactionType: t.transactionType,
          intervalUnit: t.intervalUnit,
          intervalCount: t.intervalCount,
          mode: t.mode,
          startDate: t.startDate.toISOString(),
          endDate: t.endDate ? t.endDate.toISOString() : null,
          nextRunDate: t.nextRunDate ? t.nextRunDate.toISOString() : null,
          previousRunDate: t.previousRunDate ? t.previousRunDate.toISOString() : null,
          isActive: t.isActive,
          runCount: t.runCount,
          notes: t.notes,
        }))}
      />
    </div>
  )
}
