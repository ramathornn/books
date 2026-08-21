import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

// Compute GST/HST collected (sum of credits to GST Payable) − ITCs (sum of debits to GST Receivable)
// over a date range.
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const startStr = sp.get('start')
  const endStr = sp.get('end')
  if (!startStr || !endStr) return Response.json({ error: 'start and end required' }, { status: 400 })
  const start = new Date(startStr)
  const end = new Date(endStr)
  end.setUTCHours(23, 59, 59, 999) // period dates are UTC calendar-date instants

  // Find GST/HST Payable + Receivable accounts (treat 2315 GST/HST Payable as both for now — many systems use one account)
  const gstPayable = await prisma.gLAccount.findFirst({
    where: { accountNumber: '2315' },
  })
  const gstSuspense = await prisma.gLAccount.findFirst({ where: { accountNumber: '2316' } })
  if (!gstPayable) {
    return Response.json({ error: 'No GST/HST Payable account (2315) found in chart' }, { status: 500 })
  }

  // Sum lines on GST Payable in the period from posted JEs.
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: gstPayable.id,
      journalEntry: {
        status: 'posted',
        entryDate: { gte: start, lte: end },
      },
    },
    include: {
      journalEntry: {
        select: { id: true, entryNumber: true, entryDate: true, description: true },
      },
    },
  })

  let collected = 0 // credits to GST Payable
  let paid = 0 // debits to GST Payable (which are ITCs in this single-account convention)
  for (const l of lines) {
    collected += Number(l.credit || 0)
    paid += Number(l.debit || 0)
  }

  // Also pull lines from GST Receivable if it exists separately (we use 2315 for both)
  // (no-op for current schema)

  const net = Math.round((collected - paid) * 100) / 100

  return Response.json({
    period: {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
    },
    collected: Math.round(collected * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    net,
    gstPayableAccountId: gstPayable.id,
    gstSuspenseAccountId: gstSuspense?.id || null,
    lineCount: lines.length,
    lines: lines.map((l) => ({
      id: l.id,
      entryDate: l.journalEntry.entryDate.toISOString().slice(0, 10),
      entryNumber: l.journalEntry.entryNumber,
      description: l.description || l.journalEntry.description,
      debit: Number(l.debit),
      credit: Number(l.credit),
    })),
  })
}
