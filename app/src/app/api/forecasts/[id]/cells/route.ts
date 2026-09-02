import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists } from '@/lib/forecasts/api'
import { ensureMonthCount } from '@/lib/forecasts/server'
import { isFormula } from '@/lib/forecasts/formula'
import { forecastCellsSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

// Upsert one or more cells. A string starting with "=" is stored as a formula;
// anything else is coerced to a number. Extends the month range if needed.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth()
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastCellsSchema)
  if ('error' in parsed) return parsed.error
  const { cells } = parsed.data

  const rowIds = [...new Set(cells.map((c) => c.rowId))]
  const owned = await prisma.forecastRow.count({ where: { id: { in: rowIds }, scenarioId: id } })
  if (owned !== rowIds.length) return Response.json({ error: 'One or more rows do not belong to this scenario' }, { status: 400 })

  await ensureMonthCount(id, Math.max(...cells.map((c) => c.monthIndex)))

  await prisma.$transaction(
    cells.map((c) => {
      const formula = isFormula(c.value) ? String(c.value).trim() : null
      const amount = formula ? 0 : Number(c.value) || 0
      return prisma.forecastCell.upsert({
        where: { rowId_monthIndex: { rowId: c.rowId, monthIndex: c.monthIndex } },
        create: { rowId: c.rowId, monthIndex: c.monthIndex, amount, formula },
        update: { amount, formula },
      })
    })
  )
  return Response.json({ ok: true, count: cells.length })
}
