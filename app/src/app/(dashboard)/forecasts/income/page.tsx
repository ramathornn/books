import type { Metadata } from 'next'
import IncomeClient from './IncomeClient'

export const metadata: Metadata = { title: 'Income · Forecasts' }

export default function ForecastIncomePage() {
  return <IncomeClient />
}
