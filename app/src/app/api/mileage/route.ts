import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'

// CRA 2025 standard rate: $0.70/km for the first 5,000 km, $0.64/km after.
const CRA_FIRST_TIER = 5000
const CRA_RATE_TIER1 = 0.70
const CRA_RATE_TIER2 = 0.64

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = request.nextUrl.searchParams
  const year = sp.get('year')

  const where: Record<string, unknown> = { isArchived: false }
  if (year) {
    const start = new Date(`${year}-01-01`)
    const end = new Date(`${year}-12-31T23:59:59`)
    where.date = { gte: start, lte: end }
  }

  const logs = await prisma.mileage.findMany({
    where,
    orderBy: { date: 'desc' },
  })

  // YTD totals
  const totalKm = logs.reduce((s, l) => s + Number(l.kilometres), 0)
  const totalAmount = logs.reduce((s, l) => s + Number(l.amount), 0)

  return Response.json({
    data: logs,
    summary: {
      count: logs.length,
      totalKm: Math.round(totalKm * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
      ratesUsed: { tier1: CRA_RATE_TIER1, tier1Threshold: CRA_FIRST_TIER, tier2: CRA_RATE_TIER2 },
    },
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const date = body.date ? new Date(String(body.date)) : new Date()
  const kilometres = parseFloat(String(body.kilometres || '0'))
  if (isNaN(kilometres) || kilometres <= 0) {
    return Response.json({ error: 'kilometres must be a positive number' }, { status: 400 })
  }

  // Tiered rate: figure out where this entry's km lands relative to the year-to-date total
  // (so the rate applied is correct as the user crosses the 5000 km threshold).
  const yearStart = new Date(date.getFullYear(), 0, 1)
  const yearEnd = new Date(date.getFullYear(), 11, 31, 23, 59, 59)
  const ytd = await prisma.mileage.aggregate({
    where: { isArchived: false, date: { gte: yearStart, lte: yearEnd } },
    _sum: { kilometres: true },
  })
  const kmBefore = Number(ytd._sum.kilometres || 0)
  const kmAfter = kmBefore + kilometres

  let amount = 0
  if (kmAfter <= CRA_FIRST_TIER) {
    amount = kilometres * CRA_RATE_TIER1
  } else if (kmBefore >= CRA_FIRST_TIER) {
    amount = kilometres * CRA_RATE_TIER2
  } else {
    const tier1Portion = CRA_FIRST_TIER - kmBefore
    const tier2Portion = kilometres - tier1Portion
    amount = tier1Portion * CRA_RATE_TIER1 + tier2Portion * CRA_RATE_TIER2
  }
  amount = Math.round(amount * 100) / 100
  // Effective rate (for storage) is amount/km — useful for auditing the row.
  const effectiveRate = Math.round((amount / kilometres) * 10000) / 10000

  const created = await prisma.mileage.create({
    data: {
      date,
      fromAddress: String(body.fromAddress || ''),
      toAddress: String(body.toAddress || ''),
      kilometres,
      purpose: String(body.purpose || ''),
      vehicleLabel: String(body.vehicleLabel || ''),
      ratePerKm: effectiveRate,
      amount,
      notes: String(body.notes || ''),
    },
  })

  await audit({
    entityType: 'mileage',
    entityId: created.id,
    action: 'create',
    summary: `${kilometres.toFixed(2)} km · ${created.fromAddress} → ${created.toAddress} · ${amount.toFixed(2)} CAD`,
    metadata: { kmBefore, kmAfter, effectiveRate },
  })

  return Response.json(created, { status: 201 })
}
