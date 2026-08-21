export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import ReportsLandingClient from '@/components/reports/ReportsLandingClient'

export const metadata: Metadata = { title: 'Reports' }

export default async function ReportsPage() {
  const favorites = await prisma.favoriteReport.findMany({ orderBy: { createdAt: 'asc' } })
  return (
    <ReportsLandingClient initialFavorites={favorites.map((f) => f.reportKey)} />
  )
}
