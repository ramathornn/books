import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildClassSchedule } from '@/lib/cca/service'

/**
 * CCA history for a class: the full computed schedule plus, for each year, the
 * as-filed snapshot (`filed*`), posting state, and the linked JE. Drives the
 * /accounting/cca/[classId]/history page.
 *
 *   GET /api/cca/[classId]/history
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { classId } = await params

  const schedule = await buildClassSchedule(classId)
  if (!schedule) return Response.json({ error: 'Class not found' }, { status: 404 })

  // Pull the JE numbers for any posted years.
  const jeIds = schedule.years.map((y) => y.journalEntryId).filter((x): x is string => !!x)
  const jes = jeIds.length
    ? await prisma.journalEntry.findMany({
        where: { id: { in: jeIds } },
        select: { id: true, entryNumber: true, entryDate: true, status: true },
      })
    : []
  const jeMap = new Map(jes.map((j) => [j.id, j]))

  return Response.json({
    class: schedule.class,
    years: schedule.years.map((y) => ({
      ...y,
      journalEntry: y.journalEntryId
        ? (() => {
            const j = jeMap.get(y.journalEntryId!)
            return j
              ? { id: j.id, entryNumber: j.entryNumber, entryDate: j.entryDate.toISOString().slice(0, 10), status: j.status }
              : null
          })()
        : null,
    })),
  })
}
