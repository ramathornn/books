import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { readAuth } from '@/lib/forecasts/api'
import { getCadRate } from '@/lib/fx'

// Invoiced revenue per calendar month from Books (issued, non-draft, non-void
// invoices), in CAD. Used to seed the forecast's income row with actuals.
// ?from=YYYY-MM&to=YYYY-MM (inclusive).
const ymRe = /^(\d{4})-(\d{2})$/

export async function GET(request: NextRequest) {
  const denied = await readAuth(request)
  if (denied) return denied
  const sp = request.nextUrl.searchParams
  const f = ymRe.exec(sp.get('from') ?? ''), t = ymRe.exec(sp.get('to') ?? '')
  if (!f || !t) return Response.json({ error: 'from and to are required as YYYY-MM' }, { status: 400 })
  const start = new Date(Date.UTC(+f[1], +f[2] - 1, 1))
  const end = new Date(Date.UTC(+t[1], +t[2], 1)) // exclusive
  if (end <= start) return Response.json({ error: 'to must be after from' }, { status: 400 })

  const invoices = await prisma.invoice.findMany({
    where: { dateIssued: { gte: start, lt: end }, status: { notIn: ['draft', 'void', 'archived'] } },
    select: { dateIssued: true, currency: true, total: true, cadTotal: true, fxRate: true },
  })
  const months: Record<string, number> = {}
  for (const inv of invoices) {
    const key = `${inv.dateIssued.getUTCFullYear()}-${String(inv.dateIssued.getUTCMonth() + 1).padStart(2, '0')}`
    let cad = inv.cadTotal !== null ? Number(inv.cadTotal) : null
    if (cad === null) {
      const rate = inv.fxRate !== null ? Number(inv.fxRate) : inv.currency === 'CAD' ? 1 : null
      if (rate !== null) cad = Number(inv.total) * rate
      else {
        try { cad = Number(inv.total) * (await getCadRate(inv.currency, inv.dateIssued)).rate } catch { cad = Number(inv.total) }
      }
    }
    months[key] = Math.round(((months[key] ?? 0) + cad) * 100) / 100
  }
  return Response.json({ data: { months, invoiceCount: invoices.length } })
}
