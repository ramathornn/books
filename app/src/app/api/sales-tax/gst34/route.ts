import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { computeGst34 } from '@/lib/tax/compute/gst34'

/**
 * GST34 line-numbered worksheet preview.
 *
 * Replaces the flat collected/paid/net preview with the official GST34 line
 * numbers (101/103/104/105/106/107/108/109). Line 101 is summed from posted
 * credits to income-class accounts EXCLUDING non-supply accounts (realized FX
 * gains / interest income) per the design (§6 Q4 — foreign zero-rated supplies
 * still belong on Line 101, but FX gains and interest are not supplies).
 *
 * There is no transmit file: the UI drives a printable worksheet PDF plus a
 * read-only NETFILE entry helper.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const startStr = sp.get('start')
  const endStr = sp.get('end')
  if (!startStr || !endStr) {
    return Response.json({ error: 'start and end required' }, { status: 400 })
  }
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json({ error: 'Invalid dates' }, { status: 400 })
  }

  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })

  // Non-supply income accounts excluded from Line 101 (realized FX gains, and
  // any interest-income account if one is configured by number).
  const excludeIds: string[] = []
  if (settings?.realizedFxAccountId) excludeIds.push(settings.realizedFxAccountId)
  const interestAccounts = await prisma.gLAccount.findMany({
    where: {
      accountClass: 'income',
      accountName: { contains: 'interest', mode: 'insensitive' },
    },
    select: { id: true },
  })
  for (const a of interestAccounts) if (!excludeIds.includes(a.id)) excludeIds.push(a.id)

  const result = await computeGst34({
    start,
    end,
    gstPayableAccountId: settings?.defaultGstPayableAccountId ?? null,
    excludeIncomeAccountIds: excludeIds,
  })

  return Response.json({
    period: { start: result.sourceRef.periodStart, end: result.sourceRef.periodEnd },
    lines: result.lines,
    sourceRef: result.sourceRef,
    excludedIncomeAccountIds: excludeIds,
  })
}
