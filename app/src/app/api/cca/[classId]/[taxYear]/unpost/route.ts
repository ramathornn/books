import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { getFiscalYearEnd, lockedYearSet } from '@/lib/cca/service'

/**
 * Reverse a posted CCA claim (OPEN years only).
 *
 *   POST /api/cca/[classId]/[taxYear]/unpost
 *
 * Posts an inverse `reversal` JE at the original entryDate (never deletes), then
 * unlinks the schedule row back to `draft`. Refuses when the year is locked —
 * a filed year is corrected via a catch-up in the first open year, not unposted.
 */

function parseYear(v: string): number | null {
  const n = parseInt(v, 10)
  if (!Number.isInteger(n) || n < 1990 || n > 2200) return null
  return n
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ classId: string; taxYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { classId, taxYear: taxYearStr } = await params
  const taxYear = parseYear(taxYearStr)
  if (taxYear === null) return Response.json({ error: 'invalid taxYear' }, { status: 400 })

  const row = await prisma.ccaScheduleEntry.findUnique({
    where: { classId_taxYear: { classId, taxYear } },
    include: { ccaClass: { select: { classNumber: true } } },
  })
  if (!row) return Response.json({ error: 'No schedule entry' }, { status: 404 })
  if (!row.journalEntryId) {
    return Response.json({ error: 'Nothing posted for this year.' }, { status: 409 })
  }

  const fye = await getFiscalYearEnd()
  const isLocked = await lockedYearSet(fye)
  if (isLocked(taxYear)) {
    return Response.json(
      {
        error: `Tax year ${taxYear} is locked; the CCA claim cannot be reversed. Book a catch-up in the first open year instead.`,
        code: 'PERIOD_LOCKED',
      },
      { status: 409 },
    )
  }

  const { reverseJournalEntry } = await import('@/lib/reverseJournalEntry')
  let reversal
  try {
    reversal = await reverseJournalEntry(
      row.journalEntryId,
      `Unpost CCA class ${row.ccaClass.classNumber} ${taxYear}`,
    )
  } catch (e) {
    const err = e as Error & { code?: string }
    if (err.code === 'PERIOD_LOCKED') {
      return Response.json({ error: err.message, code: 'PERIOD_LOCKED' }, { status: 409 })
    }
    return Response.json({ error: err.message || 'Failed to reverse CCA entry' }, { status: 400 })
  }

  await prisma.ccaScheduleEntry.update({
    where: { id: row.id },
    data: { status: 'draft', journalEntryId: null, postedAt: null },
  })

  await audit({
    entityType: 'journal_entry',
    entityId: row.journalEntryId,
    action: 'reverse',
    summary: `Unposted CCA class ${row.ccaClass.classNumber} ${taxYear}`,
    metadata: { module: 'cca', classId, taxYear, reversalId: reversal?.id ?? null },
  })

  return Response.json({ ok: true, reversalId: reversal?.id ?? null })
}
