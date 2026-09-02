import { NextRequest } from 'next/server'
import { readAuth } from '@/lib/forecasts/api'
import { getCadRate } from '@/lib/fx'
import { FALLBACK_RATES } from '@/lib/forecasts/currency'

// Today's CAD-per-unit rates for the forecast currencies, from Books' own
// Bank of Canada feed (shared with invoicing/FX revaluation).
export async function GET(request: NextRequest) {
  const denied = await readAuth(request)
  if (denied) return denied
  const now = new Date()
  const out: Record<string, number> = { ...FALLBACK_RATES }
  await Promise.all(
    ['USD', 'EUR'].map(async (ccy) => {
      try { out[ccy] = (await getCadRate(ccy, now)).rate } catch { /* keep fallback */ }
    })
  )
  return Response.json({ data: out })
}
