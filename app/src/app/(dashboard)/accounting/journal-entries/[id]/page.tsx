export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import JournalEntryForm from '@/components/accounting/JournalEntryForm'
import AttachmentList from '@/components/ui/AttachmentList'

export default async function EditJournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const { id } = await params
  const { docError } = await searchParams
  const [entry, accounts] = await Promise.all([
    prisma.journalEntry.findUnique({
      where: { id },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        reverses: { select: { id: true, entryNumber: true } },
        reversal: { select: { id: true, entryNumber: true } },
      },
    }),
    prisma.gLAccount.findMany({
      where: { isArchived: false },
      orderBy: { accountNumber: 'asc' },
      select: { id: true, accountNumber: true, accountName: true, accountClass: true },
    }),
  ])
  if (!entry) return notFound()

  return (
    <>
      <JournalEntryForm
        mode="edit"
        accounts={accounts}
        entry={{
          id: entry.id,
          entryNumber: entry.entryNumber,
          entryDate: entry.entryDate.toISOString(),
          description: entry.description,
          memo: entry.memo,
          status: entry.status,
          reversesId: entry.reversesId,
          reversedReason: entry.reversedReason,
          reverses: entry.reverses,
          reversal: entry.reversal,
          lines: entry.lines.map((l) => ({
            id: l.id,
            glAccountId: l.glAccountId,
            description: l.description,
            debit: Number(l.debit),
            credit: Number(l.credit),
          })),
        }}
      />

      <div className="mt-6 bg-white rounded-lg border border-[#E1E6EB] p-4">
        <h2 className="text-sm font-semibold text-[#001B40] mb-3">Source Documents</h2>
        {docError && (
          <div className="mb-3 p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">
            Some documents staged on the new entry failed to upload. The entry was saved — re-add them below.
          </div>
        )}
        <AttachmentList entityType="journal_entry" entityId={entry.id} />
      </div>
    </>
  )
}
