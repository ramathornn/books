import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { expenseSchema } from '@/lib/validators'
import { getCompanySettings } from '@/lib/company'
import { refileReceiptByDate } from '@/lib/receiptFiling'

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      category: true,
      vendor: true,
      client: true,
      project: true,
    },
  })
  if (!expense) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json(expense)
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  try {
    const body = await request.json()
    const parsed = expenseSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
    const d = parsed.data

    const vendorIdInput = d.vendorId ?? d.merchantId ?? null
    const vendorNameInput = (d.vendorName ?? d.merchantName ?? '').trim()
    let vendorId: string | null = vendorIdInput || null
    if (!vendorId && vendorNameInput) {
      const existing = await prisma.vendor.findFirst({ where: { name: vendorNameInput } })
      const vendor = existing ?? (await prisma.vendor.create({ data: { name: vendorNameInput } }))
      vendorId = vendor.id
    }

    const total = Number(d.amount) + Number(d.taxAmount || 0)
    const status = d.isBillable
      ? 'billable'
      : d.clientId || d.projectId
      ? 'non-billable'
      : 'pending'

    const expense = await prisma.expense.update({
      where: { id },
      data: {
        categoryId: d.categoryId,
        vendorId,
        taxCodeId: d.taxCodeId || null,
        clientId: d.clientId || null,
        projectId: d.projectId || null,
        date: new Date(d.date),
        amount: d.amount,
        taxAmount: d.taxAmount || 0,
        total,
        currency: d.currency,
        description: d.description || '',
        notes: d.notes || '',
        source: d.source || (await getCompanySettings()).name,
        receiptUrl: d.receiptUrl || '',
        isBillable: d.isBillable,
        isRecurring: d.isRecurring,
        recurringFrequency: d.recurringFrequency || null,
        recurringEndDate: d.recurringEndDate ? new Date(d.recurringEndDate) : null,
        status,
      },
      include: { category: true, vendor: true, client: true, project: true },
    })

    // Keep any filed receipt copy in the Files manager in sync with the (possibly
    // corrected) date — moves it to Receipts/YYYY-MM if the month changed.
    await refileReceiptByDate(expense.id, expense.date)

    return Response.json(expense)
  } catch (e) {
    console.error('Update expense error:', e)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  await prisma.expense.update({ where: { id }, data: { isArchived: true } })
  return Response.json({ ok: true })
}
