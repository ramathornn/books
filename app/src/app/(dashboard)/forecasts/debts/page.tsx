import type { Metadata } from 'next'
import DebtsClient from './DebtsClient'

export const metadata: Metadata = { title: 'Debts · Forecasts' }

export default function ForecastDebtsPage() {
  return <DebtsClient />
}
