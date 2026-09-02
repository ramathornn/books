import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { getCompanySettings } from '@/lib/company'
import { getCadRate } from '@/lib/fx'
import { ensureDefaultScenarios, loadScenario } from '@/lib/forecasts/server'
import { FALLBACK_RATES } from '@/lib/forecasts/currency'
import type { Rates } from '@/lib/forecasts/types'
import { ForecastProvider, SCENARIO_COOKIE } from '@/components/forecasts/ForecastProvider'
import { FormulaBarProvider } from '@/components/forecasts/FormulaBar'
import FormulaBar from '@/components/forecasts/FormulaBar'
import ForecastTopBar from '@/components/forecasts/ForecastTopBar'

export const dynamic = 'force-dynamic'

// Loads the selected scenario (cookie-chosen, defaults to the first) and today's
// FX rates from Books' own rate table, then hands everything to the client store.
export default async function ForecastsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const readOnly = session?.user?.role === 'accountant'
  const scenarios = await ensureDefaultScenarios()
  const cookieStore = await cookies()
  const wanted = cookieStore.get(SCENARIO_COOKIE)?.value
  const selected = scenarios.find((s) => s.id === wanted) ?? scenarios[0]
  const [data, company] = await Promise.all([loadScenario(selected.id), getCompanySettings()])
  if (!data) throw new Error('Forecast scenario could not be loaded')

  const rates: Rates = { ...FALLBACK_RATES }
  const now = new Date()
  await Promise.all(['USD', 'EUR'].map(async (ccy) => { try { rates[ccy] = (await getCadRate(ccy, now)).rate } catch { /* fallback */ } }))

  return (
    <ForecastProvider initialData={data} scenarios={scenarios} initialRates={rates} readOnly={readOnly}>
      <FormulaBarProvider>
        <ForecastTopBar fiscalYearEndMonth={company.fiscalYearEnd.month} />
        {children}
        <FormulaBar />
      </FormulaBarProvider>
    </ForecastProvider>
  )
}
