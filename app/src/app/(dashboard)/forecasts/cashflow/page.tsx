import type { Metadata } from 'next'
import CashFlowClient from './CashFlowClient'

export const metadata: Metadata = { title: 'Cash Flow · Forecasts' }

export default function ForecastCashFlowPage() {
  return <CashFlowClient />
}
