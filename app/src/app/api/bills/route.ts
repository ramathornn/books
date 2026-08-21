import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'

async function nextBillNumber(): Promise<string> {
  const last = await prisma.bill.findFirst({
    where: { billNumber: { startsWith: 'BILL-' } },
    orderBy: { billNumber: 'desc' },
    select: { billNumber: true },
  })
  const n = last ? parseInt(last.billNumber.replace(/^BILL-/, ''), 10) || 0 : 0
  return `BILL-${String(n + 1).padStart(5, '0')}`
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const status = sp.get('status')
  const vendorId = sp.get('vendorId')
  const where: Record<string, unknown> = { isArchived: false }
  if (status) where.status = status
  if (vendorId) where.vendorId = vendorId

  const bills = await prisma.bill.findMany({
    where,
    include: { vendor: true, lines: true, payments: true },
    orderBy: [{ billDate: 'desc' }],
  })
  return Response.json({ data: bills })
}

interface BillLineInput {
  description?: string
  amount: number
  taxAmount?: number
  categoryGlAccountId?: string | null
  taxCodeId?: string | null
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const billDate = body.billDate ? new Date(String(body.billDate)) : new Date()
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : new Date(billDate.getTime() + 30 * 86400000)
  const currency = String(body.currency || 'CAD')
  const status = String(body.status || 'draft') as 'draft' | 'open'
  const vendorId = body.vendorId || null
  const reference = String(body.reference || '')
  const notes = String(body.notes || '')
  const billNumber = String(body.billNumber || '').trim() || (await nextBillNumber())

  const lines: BillLineInput[] = Array.isArray(body.lines) ? body.lines : []
  if (lines.length === 0 || lines.every((l) => !l.amount)) {
    return Response.json({ error: 'At least one line with an amount is required.' }, { status: 400 })
  }

  let subtotal = 0
  let taxTotal = 0
  for (const l of lines) {
    subtotal += Number(l.amount || 0)
    taxTotal += Number(l.taxAmount || 0)
  }
  const total = subtotal + taxTotal

  const bill = await prisma.bill.create({
    data: {
      billNumber,
      vendorId,
      billDate,
      dueDate,
      currency,
      subtotal,
      taxTotal,
      total,
      amountDue: total,
      status: status,
      notes,
      reference,
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
    include: { vendor: true, lines: true },
  })

  // If status=open, post the JE: DR each expense GL, DR GST Receivable per line, CR Accounts Payable for total
  if (status === 'open') {
    await postBillJE(bill.id)
  }

  return Response.json(bill, { status: 201 })
}

async function postBillJE(billId: string) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: { lines: true, vendor: true },
  })
  if (!bill) return

  // Find A/P account (default 2000 or any A/P-class)
  const ap = await prisma.gLAccount.findFirst({
    where: { OR: [{ accountSubclass: 'Accounts Payable' }, { detailType: 'Accounts Payable' }] },
    orderBy: { accountNumber: 'asc' },
  })
  if (!ap) {
    // Create a default A/P if none exists
    const created = await prisma.gLAccount.create({
      data: {
        accountNumber: '2000',
        accountName: 'Accounts Payable',
        accountClass: 'liability',
        accountSubclass: 'Accounts payable (A/P)',
        detailType: 'Accounts Payable',
        currency: bill.currency,
      },
    })
    await postBillJEWithAP(billId, created.id)
    return
  }
  await postBillJEWithAP(billId, ap.id)
}

async function postBillJEWithAP(billId: string, apAccountId: string) {
  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    include: { lines: true, vendor: true },
  })
  if (!bill) return

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

  // Credit A/P for the full total
  jeLines.push({
    glAccountId: apAccountId,
    description: `Bill ${bill.billNumber}${bill.vendor ? ` — ${bill.vendor.name}` : ''}`,
    debit: 0,
    credit: Number(bill.total),
  })

  // Round-fix on AP credit
  const td = jeLines.reduce((s, l) => s + l.debit, 0)
  const tc = jeLines.reduce((s, l) => s + l.credit, 0)
  const diff = Math.round((td - tc) * 100) / 100
  if (diff !== 0) {
    const apLine = jeLines.find((l) => l.glAccountId === apAccountId)
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
