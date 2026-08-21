import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { buildClassSchedule } from '@/lib/cca/service'

/**
 * The CCA grid: every class with its full year-by-year computed schedule.
 *
 *   GET /api/cca/schedule[?through=2026]
 *
 * Open years are recomputed (declining-balance + half-year/AccII, closing→
 * opening rolled forward); locked years are returned as-stored. `through`
 * extends the schedule forward past the last stored year for forecasting.
 */

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const throughParam = request.nextUrl.searchParams.get('through')
  const throughYear = throughParam ? parseInt(throughParam, 10) : undefined

  const classes = await prisma.ccaClass.findMany({
    where: { isArchived: false },
    orderBy: { classNumber: 'asc' },
    select: { id: true },
  })

  const schedules = await Promise.all(
    classes.map((c) =>
      buildClassSchedule(c.id, throughYear ? { throughYear } : undefined),
    ),
  )

  return Response.json({
    classes: schedules.filter((s): s is NonNullable<typeof s> => s !== null),
  })
}
