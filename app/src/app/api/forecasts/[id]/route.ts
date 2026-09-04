import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { readAuth, writeAuth, notFound, parseBody, isUniqueViolation } from '@/lib/forecasts/api'
import { loadScenario } from '@/lib/forecasts/server'
import { forecastScenarioPatchSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

// Full scenario in the client data shape.
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await readAuth(request)
  if (denied) return denied
  const { id } = await params
  const data = await loadScenario(id)
  if (!data) return notFound()
  return Response.json(data)
}

// Rename, change the visible range, or extend the month range.
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  const parsed = await parseBody(request, forecastScenarioPatchSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data
  const s = await prisma.forecastScenario.findUnique({ where: { id }, select: { monthCount: true } })
  if (!s) return notFound()

  let monthCount = d.monthCount ?? s.monthCount
  // The visible range may extend the workbook (WealthPilot's setViewRange behaviour).
  if (d.viewTo !== undefined && d.viewTo + 1 > monthCount) monthCount = d.viewTo + 1
  const viewFrom = d.viewFrom
  const viewTo = d.viewTo
  if (viewFrom !== undefined && viewTo !== undefined && viewFrom > viewTo) {
    return Response.json({ error: 'viewFrom must be <= viewTo' }, { status: 400 })
  }
  try {
    const updated = await prisma.forecastScenario.update({
      where: { id },
      data: { name: d.name, viewFrom, viewTo, monthCount, booksLinked: d.booksLinked, ownerPayGlAccountIds: d.ownerPayGlAccountIds },
      select: { id: true, name: true, viewFrom: true, viewTo: true, monthCount: true, booksLinked: true, ownerPayGlAccountIds: true },
    })
    return Response.json(updated)
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'A scenario with that name already exists' }, { status: 409 })
    throw e
  }
}
