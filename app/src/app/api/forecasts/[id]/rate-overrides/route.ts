import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma'
import { writeAuth, notFound, parseBody, scenarioExists } from '@/lib/forecasts/api'

type Ctx = { params: Promise<{ id: string }> }
const schema = z.object({ currency: z.enum(['USD', 'EUR']), rate: z.number().positive().max(1000).nullable() })

// Set (rate) or clear (rate: null) a manual CAD-per-unit override for a currency.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, schema)
  if ('error' in parsed) return parsed.error
  const { currency, rate } = parsed.data
  if (rate === null) {
    await prisma.forecastRateOverride.deleteMany({ where: { scenarioId: id, currency } })
  } else {
    await prisma.forecastRateOverride.upsert({
      where: { scenarioId_currency: { scenarioId: id, currency } },
      create: { scenarioId: id, currency, rate },
      update: { rate },
    })
  }
  return Response.json({ ok: true })
}
