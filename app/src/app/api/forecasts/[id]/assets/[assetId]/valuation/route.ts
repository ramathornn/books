import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody } from '@/lib/forecasts/api'
import { forecastAssetValuationSchema } from '@/lib/validators'

type Ctx = { params: Promise<{ id: string; assetId: string }> }

// Re-value an asset. Accepts a bearer token (see writeAuth), so an agent can
// keep property, vehicle and investment values current without a session.
//
// One valuation per asset per day: posting twice for the same date overwrites,
// which makes a re-run of an agent idempotent rather than duplicating history.
// The asset's own `value` is refreshed only when this is the newest valuation,
// so backfilling an older date never rewrites what the asset is worth today.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id, assetId } = await params
  const asset = await prisma.forecastAsset.findFirst({ where: { id: assetId, scenarioId: id }, select: { id: true, name: true } })
  if (!asset) return notFound('Asset')

  const parsed = await parseBody(request, forecastAssetValuationSchema)
  if ('error' in parsed) return parsed.error
  const d = parsed.data

  const asOf = new Date(`${d.asOf ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(asOf.getTime())) return Response.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })

  const newest = await prisma.forecastAssetValuation.findFirst({
    where: { assetId },
    orderBy: { asOf: 'desc' },
    select: { asOf: true },
  })
  const isLatest = !newest || asOf >= newest.asOf

  const [valuation] = await prisma.$transaction([
    prisma.forecastAssetValuation.upsert({
      where: { assetId_asOf: { assetId, asOf } },
      create: { assetId, asOf, value: d.value, source: d.source, note: d.note ?? null },
      update: { value: d.value, source: d.source, note: d.note ?? null },
    }),
    ...(isLatest ? [prisma.forecastAsset.update({ where: { id: assetId }, data: { value: d.value } })] : []),
  ])

  return Response.json({
    asset: asset.name,
    asOf: valuation.asOf.toISOString().slice(0, 10),
    value: Number(valuation.value),
    source: valuation.source,
    note: valuation.note,
    appliedToAssetValue: isLatest,
  })
}

// Full valuation history for one asset, oldest first.
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id, assetId } = await params
  const asset = await prisma.forecastAsset.findFirst({
    where: { id: assetId, scenarioId: id },
    select: { id: true, name: true, type: true, value: true, reviewCadence: true, valuations: { orderBy: { asOf: 'asc' } } },
  })
  if (!asset) return notFound('Asset')
  return Response.json({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    value: Number(asset.value),
    reviewCadence: asset.reviewCadence,
    valuations: asset.valuations.map((v) => ({
      asOf: v.asOf.toISOString().slice(0, 10),
      value: Number(v.value),
      source: v.source,
      note: v.note,
    })),
  })
}
