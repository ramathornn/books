import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const amount = parseFloat(String(body.amount || '0'))
  const paymentDate = body.paymentDate ? new Date(String(body.paymentDate)) : new Date()
  const bankAccountId = String(body.bankAccountId || '') // GLAccount id
  const paymentMethod = String(body.paymentMethod || 'Bank Transfer')
  const reference = String(body.reference || '')

  if (amount <= 0) return Response.json({ error: 'amount required' }, { status: 400 })
  if (!bankAccountId) return Response.json({ error: 'bankAccountId (source GL) required' }, { status: 400 })

  const bill = await prisma.bill.findUnique({ where: { id } })
  if (!bill) return Response.json({ error: 'Bill not found' }, { status: 404 })
  if (bill.status === 'void') return Response.json({ error: 'Bill is void' }, { status: 400 })
  if (bill.status === 'paid') return Response.json({ error: 'Already paid' }, { status: 400 })

  const ap = await prisma.gLAccount.findFirst({
    where: { OR: [{ accountSubclass: 'Accounts Payable' }, { detailType: 'Accounts Payable' }] },
    orderBy: { accountNumber: 'asc' },
  })
  if (!ap) return Response.json({ error: 'No A/P account' }, { status: 500 })

  const bank = await prisma.gLAccount.findUnique({ where: { id: bankAccountId } })
  if (!bank) return Response.json({ error: 'Bank GL not found' }, { status: 400 })

  // JE: DR A/P, CR Bank
  const je = await createJournalEntry({
    entryDate: paymentDate,
    description: `Bill payment: ${bill.billNumber}`,
    memo: reference,
    status: 'posted',
    lines: [
      { glAccountId: ap.id, description: `Payment for ${bill.billNumber}`, debit: amount, credit: 0 },
      { glAccountId: bank.id, description: `Payment for ${bill.billNumber}`, debit: 0, credit: amount },
    ],
  })

  const payment = await prisma.billPayment.create({
    data: {
      billId: bill.id,
      paymentDate,
      amount,
      bankAccountId,
      journalEntryId: je.id,
      paymentMethod,
      reference,
    },
  })

  // Update bill aggregates
  const newPaid = Number(bill.amountPaid) + amount
  const newDue = Number(bill.total) - newPaid
  const newStatus = newDue <= 0.005 ? 'paid' : newPaid > 0 ? 'partial' : bill.status
  await prisma.bill.update({
    where: { id: bill.id },
    data: { amountPaid: newPaid, amountDue: Math.max(newDue, 0), status: newStatus },
  })

  return Response.json({ ok: true, paymentId: payment.id, journalEntryId: je.id })
}
