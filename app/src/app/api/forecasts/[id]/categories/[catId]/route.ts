import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, isUniqueViolation } from '@/lib/forecasts/api'
import { forecastCategorySchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string; catId: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id, catId } = await params
  const cat = await prisma.forecastCategory.findFirst({ where: { id: catId, scenarioId: id }, select: { id: true } })
  if (!cat) return notFound('Category')
  const parsed = await parseBody(request, forecastCategorySchema)
  if ('error' in parsed) return parsed.error
  try {
    const updated = await prisma.forecastCategory.update({ where: { id: catId }, data: { name: parsed.data.name }, select: { id: true, name: true } })
    return Response.json(updated)
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'A category with that name already exists' }, { status: 409 })
    throw e
  }
}

// Deleting a category deletes the rows inside it (WealthPilot semantics).
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id, catId } = await params
  const cat = await prisma.forecastCategory.findFirst({ where: { id: catId, scenarioId: id }, select: { id: true } })
  if (!cat) return notFound('Category')
  await prisma.$transaction([
    prisma.forecastRow.deleteMany({ where: { categoryId: catId } }),
    prisma.forecastCategory.delete({ where: { id: catId } }),
  ])
  return Response.json({ ok: true })
}
