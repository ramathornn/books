import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody } from '@/lib/forecasts/api'
import { forecastTaxScenarioSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string; whatIfId: string }> }

async function owned(scenarioId: string, whatIfId: string): Promise<boolean> {
  const row = await prisma.forecastTaxScenario.findFirst({ where: { id: whatIfId, scenarioId }, select: { id: true } })
  return !!row
}

// Rename a what-if, move it to another year, or replace its lines wholesale.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id, whatIfId } = await params
  if (!(await owned(id, whatIfId))) return notFound('What-if scenario')
  const parsed = await parseBody(request, forecastTaxScenarioSchema)
  if ('error' in parsed) return parsed.error
  const { year, name, lines } = parsed.data
  const updated = await prisma.forecastTaxScenario.update({
    where: { id: whatIfId },
    data: { year, ...(name === undefined ? {} : { name }), ...(lines === undefined ? {} : { lines }) },
  })
  return Response.json({ id: updated.id, year: updated.year, name: updated.name, lines: updated.lines, sortOrder: updated.sortOrder, updatedAt: updated.updatedAt.toISOString() })
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id, whatIfId } = await params
  if (!(await owned(id, whatIfId))) return notFound('What-if scenario')
  await prisma.forecastTaxScenario.delete({ where: { id: whatIfId } })
  return Response.json({ deleted: 1 })
}
