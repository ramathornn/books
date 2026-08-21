import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import JournalEntryForm from '@/components/accounting/JournalEntryForm'

export const metadata: Metadata = { title: 'New Journal Entry' }

export default async function NewJournalEntryPage() {
  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false },
    orderBy: { accountNumber: 'asc' },
    select: { id: true, accountNumber: true, accountName: true, accountClass: true },
  })
  return <JournalEntryForm mode="new" accounts={accounts} />
}
