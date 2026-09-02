import type { Metadata } from 'next'
import TaxesClient from './TaxesClient'

export const metadata: Metadata = { title: 'Taxes · Forecasts' }

export default function ForecastTaxesPage() {
  return <TaxesClient />
}
