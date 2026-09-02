import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists, isUniqueViolation } from '@/lib/forecasts/api'
import { forecastCategorySchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastCategorySchema)
  if ('error' in parsed) return parsed.error
  const last = await prisma.forecastCategory.findFirst({ where: { scenarioId: id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  try {
    const cat = await prisma.forecastCategory.create({
      data: { scenarioId: id, name: parsed.data.name, sortOrder: (last?.sortOrder ?? -1) + 1 },
      select: { id: true, name: true, sortOrder: true },
    })
    return Response.json(cat, { status: 201 })
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'A category with that name already exists' }, { status: 409 })
    throw e
  }
}
