import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { audit } from '@/lib/audit'
import { computeGst34Lines, type Gst34Lines } from '@/lib/tax/compute/gst34'
import { round2 } from '@/lib/tax/round'

// Create/update a TaxReturn record, freeze the line-numbered GST34 snapshot, AND
// post the remittance JE that clears GST Payable to GST Suspense.
//
// Back-compat: callers may still send flat { collected, paid, adjustment }. New
// callers send { lines: {line101..line109}, sourceRef }. Either way we derive
// the canonical line set, persist it in gst34Detail, and keep the legacy
// columns mapped (collectedAmount=line105, paidAmount=line108, netAmount=line109,
// adjustment=line104+line107) so existing reports keep working.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const start = new Date(String(body.periodStart || ''))
  const end = new Date(String(body.periodEnd || ''))
  end.setUTCHours(23, 59, 59, 999) // period dates are UTC calendar-date instants
  const filedAt = body.filedAt ? new Date(String(body.filedAt)) : new Date()

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return Response.json({ error: 'Invalid dates' }, { status: 400 })
  }

  // Resolve the canonical GST34 line set.
  let lines: Gst34Lines
  if (body.lines && typeof body.lines === 'object') {
    const L = body.lines as Partial<Gst34Lines>
    // Re-derive totals from the raw inputs so the snapshot is internally
    // consistent regardless of what the client posted for derived lines.
    lines = computeGst34Lines({
      revenue: Number(L.line101 || 0),
      collected: Number(L.line103 || 0),
      itcs: Number(L.line106 || 0),
      line104: Number(L.line104 || 0),
      line107: Number(L.line107 || 0),
    })
  } else {
    // Legacy flat payload.
    const collected = parseFloat(String(body.collected || '0'))
    const paid = parseFloat(String(body.paid || '0'))
    const adjustment = parseFloat(String(body.adjustment || '0'))
    lines = computeGst34Lines({
      revenue: 0,
      collected,
      itcs: paid,
      // legacy adjustment historically nudged net tax; route it through line104
      line104: adjustment,
    })
  }

  const filingFrequency = String(body.filingFrequency || 'quarterly')
  const reportingMethod = String(body.reportingMethod || 'regular')

  // Legacy column mapping (back-compat with existing reports/UI).
  const collectedAmount = lines.line105 // total GST/HST + adjustments
  const paidAmount = lines.line108 // total ITCs + adjustments
  const adjustmentAmount = round2(lines.line104 + lines.line107)
  const net = lines.line109

  const gstPayable = await prisma.gLAccount.findFirst({ where: { accountNumber: '2315' } })
  const gstSuspense = await prisma.gLAccount.findFirst({ where: { accountNumber: '2316' } })
  if (!gstPayable || !gstSuspense) {
    return Response.json(
      { error: 'GST Payable (2315) or GST Suspense (2316) account missing' },
      { status: 500 },
    )
  }

  // JE: clears GST Payable to GST Suspense (the remittance/refund clearing).
  // net positive (we owe CRA): DR GST Payable, CR GST Suspense
  // net negative (CRA owes us): DR GST Suspense, CR GST Payable
  const jeLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = []
  if (net > 0) {
    jeLines.push({ glAccountId: gstPayable.id, description: 'GST/HST remittance — clear payable', debit: net, credit: 0 })
    jeLines.push({ glAccountId: gstSuspense.id, description: 'GST/HST remittance — accrue suspense', debit: 0, credit: net })
  } else if (net < 0) {
    jeLines.push({ glAccountId: gstSuspense.id, description: 'GST/HST refund — accrue suspense', debit: -net, credit: 0 })
    jeLines.push({ glAccountId: gstPayable.id, description: 'GST/HST refund — clear payable', debit: 0, credit: -net })
  }

  let je: { id: string } | null = null
  if (jeLines.length > 0) {
    je = await createJournalEntry({
      entryDate: end,
      description: `GST/HST filing for ${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}`,
      memo: body.notes || '',
      status: 'posted',
      lines: jeLines,
    })
  }

  // Frozen GST34 line-numbered snapshot.
  const gst34Detail = {
    lines: { ...lines },
    sourceRef: body.sourceRef ?? null,
    filingFrequency,
    reportingMethod,
    frozenAt: new Date().toISOString(),
  } as Prisma.InputJsonValue

  const taxReturn = await prisma.taxReturn.upsert({
    where: { type_periodStart_periodEnd: { type: 'GST/HST', periodStart: start, periodEnd: end } },
    create: {
      type: 'GST/HST',
      periodStart: start,
      periodEnd: end,
      collectedAmount,
      paidAmount,
      adjustment: adjustmentAmount,
      netAmount: net,
      status: 'filed',
      preparedAt: new Date(),
      filedAt,
      filingFrequency,
      reportingMethod,
      gst34Detail,
      remitJournalEntryId: je?.id ?? null,
      notes: body.notes || '',
    },
    update: {
      collectedAmount,
      paidAmount,
      adjustment: adjustmentAmount,
      netAmount: net,
      status: 'filed',
      filedAt,
      filingFrequency,
      reportingMethod,
      gst34Detail,
      remitJournalEntryId: je?.id ?? null,
      notes: body.notes || '',
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: taxReturn.id,
    action: 'run',
    summary: `Filed GST/HST ${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)} — net tax (109) ${net}`,
    metadata: { line109: net, journalEntryId: je?.id ?? null },
  })

  return Response.json({ ok: true, taxReturn, journalEntryId: je?.id })
}
