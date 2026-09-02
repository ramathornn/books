// FX for forecasts. Rates are "CAD per 1 unit of currency" (USD 1.36 → $1 USD = $1.36 CAD).
// Live rates come from Books' own Bank of Canada feed (see /api/forecasts/rates);
// these fallbacks only apply if that lookup fails.

import type { Rates } from './types'

export const FALLBACK_RATES: Rates = { USD: 1.36, EUR: 1.49 }

export const FORECAST_CURRENCIES = ['CAD', 'USD', 'EUR'] as const

export function convertToCAD(value: number, currency: string, rates: Rates): number {
  if (!value || currency === 'CAD') return value || 0
  const r = rates[currency]
  return r > 0 ? value * r : value
}
