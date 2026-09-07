import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, scenarioExists } from '@/lib/forecasts/api'

type Ctx = { params: Promise<{ id: string }> }

const CADENCE_DAYS: Record<string, number> = { monthly: 30, quarterly: 91, annual: 365 }

// Every asset in the scenario with its valuation status, so an agent can ask
// "what needs re-pricing?" in one call and then PUT the ones that are due.
//
// An asset that has never been re-valued counts as due: its stored value is
// whatever was typed when it was created, which is exactly the number that goes
// stale first. `?due=1` filters to just those needing attention.
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()

  const onlyDue = request.nextUrl.searchParams.get('due') === '1'
  const assets = await prisma.forecastAsset.findMany({
    where: { scenarioId: id },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true, name: true, type: true, value: true, reviewCadence: true,
      valuations: { orderBy: { asOf: 'desc' }, take: 1 },
    },
  })

  const today = new Date()
  const rows = assets.map((a) => {
    const last = a.valuations[0] ?? null
    const lastValuedAt = last ? last.asOf.toISOString().slice(0, 10) : null
    const daysSince = last ? Math.floor((today.getTime() - last.asOf.getTime()) / 86400000) : null
    const window = CADENCE_DAYS[a.reviewCadence] ?? null
    const due = a.reviewCadence === 'none' ? false : window === null ? false : daysSince === null || daysSince >= window
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      value: Number(a.value),
      reviewCadence: a.reviewCadence,
      lastValuedAt,
      daysSinceValued: daysSince,
      due,
      neverValued: last === null,
    }
  })

  const out = onlyDue ? rows.filter((r) => r.due) : rows
  return Response.json({ scenarioId: id, asOf: today.toISOString().slice(0, 10), count: out.length, assets: out })
}
