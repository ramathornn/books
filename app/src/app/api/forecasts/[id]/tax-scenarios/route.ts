import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { readAuth, writeAuth, notFound, parseBody, scenarioExists } from '@/lib/forecasts/api'
import { forecastTaxScenarioSchema } from '@/lib/validators'
import type { WhatIfLine } from '@/lib/forecasts/taxMath'

type Ctx = { params: Promise<{ id: string }> }

export type TaxScenarioRow = { id: string; year: number; name: string; lines: WhatIfLine[]; sortOrder: number; updatedAt: string }

export async function list(scenarioId: string, year: number | null): Promise<TaxScenarioRow[]> {
  const rows = await prisma.forecastTaxScenario.findMany({
    where: { scenarioId, ...(year === null ? {} : { year }) },
    orderBy: [{ year: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map((r) => ({
    id: r.id,
    year: r.year,
    name: r.name,
    lines: (r.lines as unknown as WhatIfLine[]) ?? [],
    sortOrder: r.sortOrder,
    updatedAt: r.updatedAt.toISOString(),
  }))
}

// Saved what-if tax calculations for a scenario. ?year= filters to one year.
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await readAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const y = parseInt(request.nextUrl.searchParams.get('year') ?? '', 10)
  return Response.json({ scenarios: await list(id, Number.isInteger(y) ? y : null) })
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastTaxScenarioSchema)
  if ('error' in parsed) return parsed.error
  const { year, name, lines } = parsed.data
  const count = await prisma.forecastTaxScenario.count({ where: { scenarioId: id, year } })
  const created = await prisma.forecastTaxScenario.create({
    data: { scenarioId: id, year, name: name ?? `What if ${year}`, lines: lines ?? [], sortOrder: count },
  })
  return Response.json({ id: created.id, year: created.year, name: created.name, lines: created.lines, sortOrder: created.sortOrder, updatedAt: created.updatedAt.toISOString() })
}
