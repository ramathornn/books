import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists } from '@/lib/forecasts/api'
import { forecastReorderSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

// Persist a full ordering for one section (and, for expenses, category order +
// membership). The client sends the complete order after a drag-and-drop.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastReorderSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data

  const rowIds = d.rows.map((r) => r.id)
  const owned = await prisma.forecastRow.count({ where: { id: { in: rowIds }, scenarioId: id, section: d.section } })
  if (owned !== rowIds.length) return Response.json({ error: 'Row list does not match this scenario/section' }, { status: 400 })
  if (d.categories?.length) {
    const catIds = d.categories.map((c) => c.id)
    const ownedCats = await prisma.forecastCategory.count({ where: { id: { in: catIds }, scenarioId: id } })
    if (ownedCats !== catIds.length) return Response.json({ error: 'Category list does not match this scenario' }, { status: 400 })
  }

  await prisma.$transaction([
    ...(d.categories ?? []).map((c) => prisma.forecastCategory.update({ where: { id: c.id }, data: { sortOrder: c.sortOrder } })),
    ...d.rows.map((r) =>
      prisma.forecastRow.update({
        where: { id: r.id },
        data: { sortOrder: r.sortOrder, ...(d.section === 'expense' && r.categoryId !== undefined ? { categoryId: r.categoryId } : {}) },
      })
    ),
  ])
  return Response.json({ ok: true })
}
