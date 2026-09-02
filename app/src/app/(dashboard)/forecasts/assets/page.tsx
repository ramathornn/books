import type { Metadata } from 'next'
import AssetsClient from './AssetsClient'

export const metadata: Metadata = { title: 'Assets · Forecasts' }

export default function ForecastAssetsPage() {
  return <AssetsClient />
}
