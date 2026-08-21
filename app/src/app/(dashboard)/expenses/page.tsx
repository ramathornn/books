export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import PrimaryButton from '@/components/ui/PrimaryButton'
import ExpenseRecentlyUpdated from '@/components/expense/ExpenseRecentlyUpdated'
import ExpenseTable from '@/components/expense/ExpenseTable'
import ExpenseFilterPanel from '@/components/expense/ExpenseFilterPanel'
import ScanReceiptButton from './ScanReceiptButton'
import BankExpensesSection from './BankExpensesSection'

export const metadata: Metadata = { title: 'Expenses' }

const DEFAULT_PER_PAGE = 25

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const perPage = Number(params.perPage) || DEFAULT_PER_PAGE
  const search = typeof params.search === 'string' ? params.search : undefined
  const categoryId = typeof params.categoryId === 'string' ? params.categoryId : undefined
  const clientId = typeof params.clientId === 'string' ? params.clientId : undefined
  const status = typeof params.status === 'string' ? params.status : undefined
  const from = typeof params.from === 'string' ? params.from : undefined
  const to = typeof params.to === 'string' ? params.to : undefined
  const sortBy = typeof params.sortBy === 'string' ? params.sortBy : 'date'
  const sortOrder = typeof params.sortOrder === 'string' ? params.sortOrder : 'desc'

  const where: Record<string, unknown> = { isArchived: false }
  if (categoryId) where.categoryId = categoryId
  if (clientId) where.clientId = clientId
  if (status) where.status = status
  if (from || to) {
    const df: Record<string, Date> = {}
    if (from) df.gte = new Date(from)
    if (to) df.lte = new Date(to)
    where.date = df
  }
  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { notes: { contains: search, mode: 'insensitive' } },
      { vendor: { name: { contains: search, mode: 'insensitive' } } },
      { category: { name: { contains: search, mode: 'insensitive' } } },
    ]
  }

  const [expenses, totalCount, recent, categories, clients] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        category: true,
        vendor: true,
        client: { select: { id: true, firstName: true, lastName: true, organization: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { [sortBy === 'date' ? 'date' : sortBy]: sortOrder === 'asc' ? 'asc' : 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.expense.count({ where }),
    prisma.expense.findMany({
      where: { isArchived: false },
      include: { category: true, vendor: true },
      orderBy: { updatedAt: 'desc' },
      take: 6,
    }),
    prisma.expenseCategory.findMany({
      where: { isArchived: false },
      orderBy: [{ groupName: 'asc' }, { name: 'asc' }],
    }),
    prisma.client.findMany({
      select: { id: true, firstName: true, lastName: true, organization: true },
      orderBy: [{ organization: 'asc' }, { lastName: 'asc' }],
      take: 500,
    }),
  ])

  const totalPages = Math.ceil(totalCount / perPage)

  const bankAccts = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    include: { glAccount: { select: { accountName: true } } },
    orderBy: { sortOrder: 'asc' },
  })

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-[28px] sm:text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Expenses
        </h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Link
            href="/expenses/receipts"
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] transition-colors"
          >
            Receipts
          </Link>
          <Link
            href="/expenses/categories"
            className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] transition-colors"
          >
            Categories
          </Link>
          <ScanReceiptButton />
          <PrimaryButton href="/expenses/new">New Expense</PrimaryButton>
        </div>
      </div>

      {recent.length > 0 && (
        <ExpenseRecentlyUpdated
          items={recent.map((e) => ({
            id: e.id,
            category: e.category.name,
            vendor: e.vendor?.name || '',
            date: formatDate(e.date),
            amount: formatCurrency(Number(e.total), e.currency, { includeCode: false }),
          }))}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-6">
        <div>
          <ExpenseTable
            rows={expenses.map((e) => ({
              id: e.id,
              vendor: e.vendor?.name || '',
              category: e.category.name,
              date: e.date.toISOString(),
              source: e.source,
              clientName: e.client
                ? e.client.organization || `${e.client.firstName} ${e.client.lastName}`.trim()
                : '',
              projectName: e.project?.name || '',
              description: e.description,
              amount: Number(e.total),
              currency: e.currency,
              status: e.status,
              receiptUrl: e.receiptUrl,
            }))}
            totalCount={totalCount}
            totalPages={totalPages}
            page={page}
            perPage={perPage}
            sortBy={sortBy}
            sortOrder={sortOrder}
            search={search || ''}
          />
        </div>
        <ExpenseFilterPanel
          categories={categories.map((c) => ({ id: c.id, name: c.name, groupName: c.groupName }))}
          clients={clients.map((c) => ({
            id: c.id,
            name: c.organization || `${c.firstName} ${c.lastName}`.trim(),
          }))}
          currentStatus={status || ''}
          currentCategoryId={categoryId || ''}
          currentClientId={clientId || ''}
          currentFrom={from || ''}
          currentTo={to || ''}
        />
      </div>

      <BankExpensesSection
        bankAccounts={bankAccts.map((b) => ({ id: b.id, name: b.glAccount.accountName }))}
      />
    </div>
  )
}
