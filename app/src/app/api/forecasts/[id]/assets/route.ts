import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists, isUniqueViolation } from '@/lib/forecasts/api'
import { forecastAssetSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastAssetSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data
  if (d.linkedDebtId) {
    const debt = await prisma.forecastRow.findFirst({ where: { id: d.linkedDebtId, scenarioId: id, section: 'debt' }, select: { id: true } })
    if (!debt) return notFound('Linked debt')
  }
  const last = await prisma.forecastAsset.findFirst({ where: { scenarioId: id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
  try {
    const asset = await prisma.forecastAsset.create({
      data: { scenarioId: id, name: d.name, type: d.type, value: d.value, linkedDebtId: d.linkedDebtId ?? null, sortOrder: (last?.sortOrder ?? -1) + 1 },
      select: { id: true, name: true, type: true, value: true, linkedDebtId: true },
    })
    return Response.json({ ...asset, value: Number(asset.value) }, { status: 201 })
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'An asset with that name already exists' }, { status: 409 })
    throw e
  }
}
