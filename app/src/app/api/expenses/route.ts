import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { expenseSchema } from '@/lib/validators'
import { getCompanySettings } from '@/lib/company'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const page = parseInt(sp.get('page') || '1', 10)
  const limit = Math.min(parseInt(sp.get('limit') || '30', 10), 200)
  const search = sp.get('search')
  const categoryId = sp.get('categoryId')
  const clientId = sp.get('clientId')
  const status = sp.get('status')
  const currency = sp.get('currency')
  const from = sp.get('from')
  const to = sp.get('to')
  const sortBy = sp.get('sortBy') || 'date'
  const sortOrder = sp.get('sortOrder') === 'asc' ? 'asc' : 'desc'

  const where: Record<string, unknown> = { isArchived: false }
  if (categoryId) where.categoryId = categoryId
  if (clientId) where.clientId = clientId
  if (status) where.status = status
  if (currency) where.currency = currency
  if (from || to) {
    const dateFilter: Record<string, Date> = {}
    if (from) dateFilter.gte = new Date(from)
    if (to) dateFilter.lte = new Date(to)
    where.date = dateFilter
  }
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
      { category: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        category: true,
        vendor: true,
        client: { select: { id: true, firstName: true, lastName: true, organization: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.expense.count({ where }),
  ])

  return Response.json({
    data: expenses,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

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

    // Resolve vendor (create if new name given). Accept legacy merchant aliases.
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

    const expense = await prisma.expense.create({
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

    return Response.json(expense, { status: 201 })
  } catch (e) {
    console.error('Create expense error:', e)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
