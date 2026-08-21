export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import MileageClient from './MileageClient'

export const metadata: Metadata = { title: 'Mileage' }

export default async function MileagePage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const year = typeof sp.year === 'string' ? sp.year : String(new Date().getFullYear())
  const yStart = new Date(`${year}-01-01`)
  const yEnd = new Date(`${year}-12-31T23:59:59`)

  const logs = await prisma.mileage.findMany({
    where: { isArchived: false, date: { gte: yStart, lte: yEnd } },
    orderBy: { date: 'desc' },
  })
  const totalKm = logs.reduce((s, l) => s + Number(l.kilometres), 0)
  const totalAmount = logs.reduce((s, l) => s + Number(l.amount), 0)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Mileage
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            Track business km using CRA 2025 rates: $0.70/km for the first 5,000 km, $0.64/km after.
          </p>
        </div>
      </div>

      <MileageClient
        year={year}
        logs={logs.map((l) => ({
          id: l.id,
          date: l.date.toISOString(),
          fromAddress: l.fromAddress,
          toAddress: l.toAddress,
          kilometres: Number(l.kilometres),
          purpose: l.purpose,
          vehicleLabel: l.vehicleLabel,
          ratePerKm: Number(l.ratePerKm),
          amount: Number(l.amount),
          notes: l.notes,
        }))}
        summary={{
          count: logs.length,
          totalKm: Math.round(totalKm * 100) / 100,
          totalAmount: Math.round(totalAmount * 100) / 100,
        }}
      />
    </div>
  )
}
