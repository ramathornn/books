import type { Metadata } from 'next'
import OverviewClient from './OverviewClient'

export const metadata: Metadata = { title: 'Forecasts' }

export default function ForecastsOverviewPage() {
  return <OverviewClient />
}
