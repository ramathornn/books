import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody } from '@/lib/forecasts/api'
import { forecastFlowDaySchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

// Set the day-of-month a cell lands on. scope 'month' = override for that
// month only; 'onward' = schedule point from that month forward (and clears
// any override at the same month, mirroring the WealthPilot updater).
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id } = await params
  const parsed = await parseBody(request, forecastFlowDaySchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data
  const row = await prisma.forecastRow.findFirst({ where: { id: d.rowId, scenarioId: id }, select: { id: true } })
  if (!row) return notFound('Row')
  const day = d.day === 'last' ? null : d.day
  const kind = d.scope === 'onward' ? 'schedule' : 'override'
  await prisma.$transaction([
    ...(kind === 'schedule'
      ? [prisma.forecastFlowDay.deleteMany({ where: { rowId: d.rowId, monthIndex: d.monthIndex, kind: 'override' } })]
      : []),
    prisma.forecastFlowDay.upsert({
      where: { rowId_monthIndex_kind: { rowId: d.rowId, monthIndex: d.monthIndex, kind } },
      create: { rowId: d.rowId, monthIndex: d.monthIndex, kind, day },
      update: { day },
    }),
  ])
  return Response.json({ ok: true })
}

// Clear both the override and any schedule point at ?rowId=&monthIndex=.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id } = await params
  const sp = request.nextUrl.searchParams
  const rowId = sp.get('rowId') ?? ''
  const monthIndex = Number.parseInt(sp.get('monthIndex') ?? '', 10)
  if (!rowId || !Number.isInteger(monthIndex)) return Response.json({ error: 'rowId and monthIndex required' }, { status: 400 })
  const row = await prisma.forecastRow.findFirst({ where: { id: rowId, scenarioId: id }, select: { id: true } })
  if (!row) return notFound('Row')
  await prisma.forecastFlowDay.deleteMany({ where: { rowId, monthIndex } })
  return Response.json({ ok: true })
}
