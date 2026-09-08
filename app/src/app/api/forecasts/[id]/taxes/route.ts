import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { readAuth, writeAuth, notFound, parseBody, scenarioExists } from '@/lib/forecasts/api'
import { loadScenario } from '@/lib/forecasts/server'
import { computeForecast } from '@/lib/forecasts/computed'
import { projectCorporateTax, projectPersonalTax, type TaxOverride, type TaxOverrideField } from '@/lib/forecasts/taxes'
import { forecastTaxOverrideSchema } from '@/lib/validators'
import { FALLBACK_RATES } from '@/lib/forecasts/currency'
import { getCadRate } from '@/lib/fx'
import { getCompanySettings } from '@/lib/company'
import type { Rates } from '@/lib/forecasts/types'

type Ctx = { params: Promise<{ id: string }> }

/** Manual corrections stored for this scenario + year. */
async function loadOverrides(scenarioId: string, year: number): Promise<TaxOverride[]> {
  const rows = await prisma.forecastTaxOverride.findMany({
    where: { scenarioId, year },
    orderBy: { field: 'asc' },
    select: { field: true, value: true, note: true, updatedAt: true },
  })
  return rows.map((r) => ({
    field: r.field as TaxOverrideField,
    value: Number(r.value),
    note: r.note,
    updatedAt: r.updatedAt.toISOString(),
  }))
}

// Projected tax bill for a scenario. Personal → calendar ?year=; Business →
// fiscal ?year= (the year the fiscal year ends in). Defaults to the current one.
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await readAuth(request)
  if (denied) return denied
  const { id } = await params
  const data = await loadScenario(id)
  if (!data) return notFound()
  const company = await getCompanySettings()
  const now = new Date()
  const rates: Rates = { ...FALLBACK_RATES }
  await Promise.all(['USD', 'EUR'].map(async (ccy) => { try { rates[ccy] = (await getCadRate(ccy, now)).rate } catch { /* fallback */ } }))
  for (const [ccy, v] of Object.entries(data.rateOverrides)) rates[ccy] = v
  const c = computeForecast(data, rates, now)

  const province = company.province || 'AB'
  const fye = company.fiscalYearEnd
  const currentFy = now.getMonth() + 1 > fye.month ? now.getFullYear() + 1 : now.getFullYear()
  const requested = parseInt(request.nextUrl.searchParams.get('year') ?? '', 10)
  const year = Number.isInteger(requested) && requested >= 2020 && requested <= 2100 ? requested : data.kind === 'business' ? currentFy : now.getFullYear()

  const overrides = await loadOverrides(id, year)
  const projection = data.kind === 'business'
    ? projectCorporateTax(data, c, year, fye, province, overrides)
    : projectPersonalTax(data, c, year, province, overrides)
  return Response.json({ data: projection, options: { years: data.kind === 'business' ? [currentFy - 1, currentFy, currentFy + 1] : [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1], fiscalYearEnd: fye } })
}

// Set or clear manual corrections for one year. Bearer-writable so an agent can
// force a figure the workbook does not know about (a dividend funded from the
// shareholder loan, say). Send `value: null` to drop an override.
export async function PUT(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const parsed = await parseBody(request, forecastTaxOverrideSchema)
  if ('error' in parsed) return parsed.error
  const { year, overrides } = parsed.data

  for (const o of overrides) {
    if (o.value === null) {
      await prisma.forecastTaxOverride.deleteMany({ where: { scenarioId: id, year, field: o.field } })
      continue
    }
    await prisma.forecastTaxOverride.upsert({
      where: { scenarioId_year_field: { scenarioId: id, year, field: o.field } },
      create: { scenarioId: id, year, field: o.field, value: o.value, note: o.note ?? null },
      update: { value: o.value, note: o.note ?? null },
    })
  }
  return Response.json({ year, overrides: await loadOverrides(id, year) })
}

// Clear every override for a year (?year=2026), or all of them.
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const denied = await writeAuth(request)
  if (denied) return denied
  const { id } = await params
  if (!(await scenarioExists(id))) return notFound()
  const y = parseInt(request.nextUrl.searchParams.get('year') ?? '', 10)
  const where = Number.isInteger(y) ? { scenarioId: id, year: y } : { scenarioId: id }
  const { count } = await prisma.forecastTaxOverride.deleteMany({ where })
  return Response.json({ deleted: count })
}
