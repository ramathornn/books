import type { Metadata } from 'next'
import SettingsClient from './SettingsClient'

export const metadata: Metadata = { title: 'Settings · Forecasts' }

export default function ForecastSettingsPage() {
  return <SettingsClient />
}
