import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists } from '@/lib/forecasts/api'
import { ensureMonthCount } from '@/lib/forecasts/server'
import { forecastBankBalanceSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

// Record (or replace) a cash-on-hand snapshot for a month.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastBankBalanceSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data
  await ensureMonthCount(id, d.monthIndex)
  const snap = await prisma.forecastBankBalance.upsert({
    where: { scenarioId_monthIndex: { scenarioId: id, monthIndex: d.monthIndex } },
    create: { scenarioId: id, monthIndex: d.monthIndex, day: d.day, amount: d.amount },
    update: { day: d.day, amount: d.amount },
    select: { monthIndex: true, day: true, amount: true },
  })
  return Response.json({ monthIndex: snap.monthIndex, day: snap.day, amount: Number(snap.amount) })
}

// Remove the snapshot for ?monthIndex=N.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  const monthIndex = Number.parseInt(request.nextUrl.searchParams.get('monthIndex') ?? '', 10)
  if (!Number.isInteger(monthIndex) || monthIndex < 0) return Response.json({ error: 'monthIndex required' }, { status: 400 })
  await prisma.forecastBankBalance.deleteMany({ where: { scenarioId: id, monthIndex } })
  return Response.json({ ok: true })
}
