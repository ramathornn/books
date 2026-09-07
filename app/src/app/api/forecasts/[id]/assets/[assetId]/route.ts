import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, isUniqueViolation } from '@/lib/forecasts/api'
import { forecastAssetSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string; assetId: string }> }

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id, assetId } = await params
  const asset = await prisma.forecastAsset.findFirst({ where: { id: assetId, scenarioId: id }, select: { id: true, value: true } })
  if (!asset) return notFound('Asset')
  const parsed = await parseBody(request, forecastAssetSchema.partial())
  if ('error' in parsed) return parsed.error
  const d = parsed.data
  if (d.linkedDebtId) {
    const debt = await prisma.forecastRow.findFirst({ where: { id: d.linkedDebtId, scenarioId: id, section: 'debt' }, select: { id: true } })
    if (!debt) return notFound('Linked debt')
  }
  try {
    const updated = await prisma.forecastAsset.update({
      where: { id: assetId },
      data: { name: d.name, type: d.type, value: d.value, linkedDebtId: d.linkedDebtId, reviewCadence: d.reviewCadence },
      select: { id: true, name: true, type: true, value: true, linkedDebtId: true },
    })
    // A hand-edited value is a re-valuation too — record it so the net-worth
    // series and the "last valued" status don't only reflect agent updates.
    if (d.value !== undefined && Number(asset.value) !== d.value) {
      const asOf = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
      await prisma.forecastAssetValuation.upsert({
        where: { assetId_asOf: { assetId, asOf } },
        create: { assetId, asOf, value: d.value, source: 'manual' },
        update: { value: d.value, source: 'manual' },
      })
    }
    return Response.json({ ...updated, value: Number(updated.value) })
  } catch (e) {
    if (isUniqueViolation(e)) return Response.json({ error: 'An asset with that name already exists' }, { status: 409 })
    throw e
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id, assetId } = await params
  const asset = await prisma.forecastAsset.findFirst({ where: { id: assetId, scenarioId: id }, select: { id: true } })
  if (!asset) return notFound('Asset')
  await prisma.forecastAsset.delete({ where: { id: assetId } })
  return Response.json({ ok: true })
}
