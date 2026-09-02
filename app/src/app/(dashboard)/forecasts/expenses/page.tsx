import type { Metadata } from 'next'
import ExpensesClient from './ExpensesClient'

export const metadata: Metadata = { title: 'Expenses · Forecasts' }

export default function ForecastExpensesPage() {
  return <ExpensesClient />
}
