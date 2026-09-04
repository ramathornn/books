import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists, isUniqueViolation } from '@/lib/forecasts/api'
import { forecastRowCreateSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

// Add an income / expense / debt row (appended to the end of its section or category).
export async function POST(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastRowCreateSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data

  if (d.categoryId) {
    const cat = await prisma.forecastCategory.findFirst({ where: { id: d.categoryId, scenarioId: id }, select: { id: true } })
    if (!cat) return notFound('Category')
  }
  const last = await prisma.forecastRow.findFirst({ where: { scenarioId: id, section: d.section }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  try {
    const row = await prisma.forecastRow.create({
      data: {
        scenarioId: id,
        section: d.section,
        name: d.name,
        currency: d.section === 'income' ? d.currency ?? 'CAD' : 'CAD',
        categoryId: d.section === 'expense' ? d.categoryId ?? null : null,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: { id: true, section: true, name: true, currency: true, categoryId: true, sortOrder: true },
    })
    return Response.json(row, { status: 201 })
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'A row with that name already exists in this section' }, { status: 409 })
    throw e
  }
}
