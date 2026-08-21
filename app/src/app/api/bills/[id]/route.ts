import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry, voidJournalEntry } from '@/lib/journalEntry'

interface BillLineInput {
  description?: string
  amount: number
  taxAmount?: number
  categoryGlAccountId?: string | null
  taxCodeId?: string | null
}

async function postBillJE(billId: string) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: { lines: true, vendor: true },
  })
  if (!bill) return

  let ap = await prisma.gLAccount.findFirst({
    where: { OR: [{ accountSubclass: 'Accounts Payable' }, { detailType: 'Accounts Payable' }, { detailType: 'Accounts Payable (A/P)' }] },
    orderBy: { accountNumber: 'asc' },
  })
  if (!ap) {
    ap = await prisma.gLAccount.create({
      data: {
        accountNumber: '2000',
        accountName: 'Accounts Payable',
        accountClass: 'liability',
        accountSubclass: 'Accounts payable (A/P)',
        detailType: 'Accounts Payable (A/P)',
        currency: bill.currency,
      },
    })
  }

  const jeLines: Array<{ glAccountId: string; description: string; debit: number; credit: number; taxCodeId?: string | null }> = []

  for (const l of bill.lines) {
    if (l.categoryGlAccountId) {
      jeLines.push({
        glAccountId: l.categoryGlAccountId,
        description: l.description || bill.reference,
        debit: Number(l.amount),
        credit: 0,
        taxCodeId: l.taxCodeId,
      })
    }
    if (Number(l.taxAmount) > 0 && l.taxCodeId) {
      const taxCode = await prisma.taxCode.findUnique({ where: { id: l.taxCodeId } })
      if (taxCode?.receivableAccountId) {
        jeLines.push({
          glAccountId: taxCode.receivableAccountId,
          description: `${taxCode.name} on bill ${bill.billNumber}`,
          debit: Number(l.taxAmount),
          credit: 0,
        })
      }
    }
  }

  jeLines.push({
    glAccountId: ap.id,
    description: `Bill ${bill.billNumber}${bill.vendor ? ` — ${bill.vendor.name}` : ''}`,
    debit: 0,
    credit: Number(bill.total),
  })

  const td = jeLines.reduce((s, l) => s + l.debit, 0)
  const tc = jeLines.reduce((s, l) => s + l.credit, 0)
  const diff = Math.round((td - tc) * 100) / 100
  if (diff !== 0) {
    const apLine = jeLines.find((l) => l.glAccountId === ap!.id)
    if (apLine) apLine.credit = Math.round((apLine.credit + diff) * 100) / 100
  }

  const je = await createJournalEntry({
    entryDate: bill.billDate,
    description: `Bill ${bill.billNumber}${bill.vendor ? ` — ${bill.vendor.name}` : ''}`,
    memo: bill.notes,
    status: 'posted',
    lines: jeLines,
  })

  await prisma.bill.update({
    where: { id: bill.id },
    data: { journalEntryId: je.id, postedAt: new Date(), status: 'open' },
  })
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: { vendor: true, lines: true, payments: true },
  })
  if (!bill) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(bill)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const existing = await prisma.bill.findUnique({ where: { id } })
  if (!existing) return Response.json({ error: 'Not found' }, { status: 404 })
  if (existing.status === 'paid' || existing.status === 'partial') {
    return Response.json({ error: 'Cannot edit a bill with payments. Void payments first.' }, { status: 400 })
  }
  if (existing.status === 'void') {
    return Response.json({ error: 'Bill is voided' }, { status: 400 })
  }

  const body = await request.json()
  const billDate = body.billDate ? new Date(String(body.billDate)) : existing.billDate
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : existing.dueDate
  const currency = body.currency ? String(body.currency) : existing.currency
  const status = body.status ? String(body.status) : existing.status
  const lines: BillLineInput[] = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0) {
    return Response.json({ error: 'At least one line is required.' }, { status: 400 })
  }

  let subtotal = 0
  let taxTotal = 0
  for (const l of lines) {
    subtotal += Number(l.amount || 0)
    taxTotal += Number(l.taxAmount || 0)
  }
  const total = subtotal + taxTotal

  // Replace lines (delete + recreate is simplest given line ids weren't passed)
  await prisma.billLineItem.deleteMany({ where: { billId: id } })

  // Void the old JE before posting a fresh one (only if previously posted)
  if (existing.journalEntryId && existing.status === 'open') {
    try { await voidJournalEntry(existing.journalEntryId) } catch (e) { console.error('void old JE failed', e) }
  }

  await prisma.bill.update({
    where: { id },
    data: {
      vendorId: body.vendorId === undefined ? existing.vendorId : (body.vendorId || null),
      billDate,
      dueDate,
      currency,
      subtotal,
      taxTotal,
      total,
      amountDue: total - Number(existing.amountPaid),
      status: status === 'open' ? 'draft' : status, // temporarily flip to draft; postBillJE flips to open
      notes: body.notes !== undefined ? String(body.notes) : existing.notes,
      reference: body.reference !== undefined ? String(body.reference) : existing.reference,
      journalEntryId: null,
      postedAt: null,
      lines: {
        create: lines.map((l, i) => ({
          description: l.description || '',
          amount: Number(l.amount || 0),
          taxAmount: Number(l.taxAmount || 0),
          categoryGlAccountId: l.categoryGlAccountId || null,
          taxCodeId: l.taxCodeId || null,
          sortOrder: i,
        })),
      },
    },
  })

  if (status === 'open') {
    await postBillJE(id)
  }

  const updated = await prisma.bill.findUnique({
    where: { id },
    include: { vendor: true, lines: true, payments: true },
  })
  return Response.json(updated)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const bill = await prisma.bill.findUnique({ where: { id } })
  if (!bill) return Response.json({ error: 'Not found' }, { status: 404 })
  if (Number(bill.amountPaid) > 0) {
    return Response.json({ error: 'Bill has payments — void those first.' }, { status: 400 })
  }
  if (bill.journalEntryId) {
    try { await voidJournalEntry(bill.journalEntryId) } catch {}
  }
  await prisma.bill.update({ where: { id }, data: { isArchived: true, status: 'void' } })
  return Response.json({ ok: true })
}
