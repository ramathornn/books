import { NextRequest } from 'next/server'
import { readAuth, notFound } from '@/lib/forecasts/api'
import { loadScenario } from '@/lib/forecasts/server'
import { computeForecast } from '@/lib/forecasts/computed'
import { projectCorporateTax, projectPersonalTax } from '@/lib/forecasts/taxes'
import { FALLBACK_RATES } from '@/lib/forecasts/currency'
import { getCadRate } from '@/lib/fx'
import { getCompanySettings } from '@/lib/company'
import type { Rates } from '@/lib/forecasts/types'

type Ctx = { params: Promise<{ id: string }> }

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

  const projection = data.kind === 'business' ? projectCorporateTax(data, c, year, fye, province) : projectPersonalTax(data, c, year, province)
  return Response.json({ data: projection, options: { years: data.kind === 'business' ? [currentFy - 1, currentFy, currentFy + 1] : [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1], fiscalYearEnd: fye } })
}
