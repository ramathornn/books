export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { formatCurrency, formatInvoiceNumber } from '@/lib/utils'
import StatsTripletCarousel from '@/components/ui/StatsTripletCarousel'
import PillToggle from '@/components/ui/PillToggle'
import PrimaryButton from '@/components/ui/PrimaryButton'
import InvoiceRecentlyUpdated from './InvoiceRecentlyUpdated'
import InvoiceMoreActions from './InvoiceMoreActions'
import InvoicesListSection from './InvoicesListSection'

export const metadata: Metadata = {
  title: 'Invoices',
}

const DEFAULT_PER_PAGE = 50

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const perPage = Number(params.perPage) || DEFAULT_PER_PAGE
  const search = typeof params.search === 'string' ? params.search : undefined
  const sortBy = typeof params.sortBy === 'string' ? params.sortBy : 'dateIssued'
  const sortOrder = typeof params.sortOrder === 'string' ? params.sortOrder : 'desc'
  const tab = typeof params.tab === 'string' ? params.tab : 'from-me'

  const now = new Date()

  // Accountant (read-only) sessions never see draft invoices — drafts are
  // unsent working documents, not books-of-record.
  const session = await auth()
  const hideDrafts = session?.user?.role === 'accountant'

  // Read advanced filters from URL so SSR matches client state
  const adv = {
    status: typeof params.status === 'string' ? params.status : '',
    clientId: typeof params.clientId === 'string' ? params.clientId : '',
    dateIssuedFrom:
      typeof params.dateIssuedFrom === 'string' ? params.dateIssuedFrom : '',
    dateIssuedTo:
      typeof params.dateIssuedTo === 'string' ? params.dateIssuedTo : '',
    dateDueFrom:
      typeof params.dateDueFrom === 'string' ? params.dateDueFrom : '',
    dateDueTo: typeof params.dateDueTo === 'string' ? params.dateDueTo : '',
    amountMin: typeof params.amountMin === 'string' ? params.amountMin : '',
    amountMax: typeof params.amountMax === 'string' ? params.amountMax : '',
    currency: typeof params.currency === 'string' ? params.currency : '',
    keyword: typeof params.keyword === 'string' ? params.keyword : '',
  }

  // Build where clause -- no status filters (D1)
  const andClauses: Record<string, unknown>[] = []

  if (search) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { client: { organization: { contains: search, mode: 'insensitive' } } },
      ],
    })
  }

  if (adv.keyword) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: adv.keyword, mode: 'insensitive' } },
        { description: { contains: adv.keyword, mode: 'insensitive' } },
        { notes: { contains: adv.keyword, mode: 'insensitive' } },
        { reference: { contains: adv.keyword, mode: 'insensitive' } },
      ],
    })
  }

  // Multi-select status, matching the effective status shown on the badges
  // (overdue is derived; sent/viewed/partial only count while not yet past due).
  const statuses = adv.status
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (statuses.length > 0) {
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
    const statusOr: Record<string, unknown>[] = statuses.map((s) => {
      if (s === 'overdue') {
        return {
          status: { notIn: ['paid', 'draft', 'archived', 'refunded'] },
          dateDue: { lt: today },
        }
      }
      if (s === 'paid' || s === 'draft') {
        return { status: s }
      }
      return { status: s, dateDue: { gte: today } }
    })
    andClauses.push(statusOr.length === 1 ? statusOr[0] : { OR: statusOr })
  }
  if (adv.clientId) andClauses.push({ clientId: adv.clientId })
  if (adv.currency) andClauses.push({ currency: adv.currency })

  if (adv.dateIssuedFrom || adv.dateIssuedTo) {
    const range: Record<string, Date> = {}
    if (adv.dateIssuedFrom) range.gte = new Date(adv.dateIssuedFrom)
    if (adv.dateIssuedTo) range.lte = new Date(adv.dateIssuedTo)
    andClauses.push({ dateIssued: range })
  }

  if (adv.dateDueFrom || adv.dateDueTo) {
    const range: Record<string, Date> = {}
    if (adv.dateDueFrom) range.gte = new Date(adv.dateDueFrom)
    if (adv.dateDueTo) range.lte = new Date(adv.dateDueTo)
    andClauses.push({ dateDue: range })
  }

  if (adv.amountMin || adv.amountMax) {
    const range: Record<string, number> = {}
    if (adv.amountMin) range.gte = Number(adv.amountMin)
    if (adv.amountMax) range.lte = Number(adv.amountMax)
    andClauses.push({ total: range })
  }

  if (hideDrafts) andClauses.push({ status: { not: 'draft' } })

  const where: Record<string, unknown> =
    andClauses.length > 0 ? { AND: andClauses } : {}

  // Stats: group by currency for carousel (D4)
  const [overdueInvoices, outstandingInvoices, draftInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { notIn: ['paid', 'draft', 'refunded'] },
        dateDue: { lt: now },
      },
      select: { amountDue: true, currency: true },
    }),
    prisma.invoice.findMany({
      where: {
        status: { notIn: ['paid', 'draft'] },
      },
      select: { amountDue: true, currency: true },
    }),
    hideDrafts
      ? Promise.resolve([])
      : prisma.invoice.findMany({
          where: { status: 'draft' },
          select: { total: true, currency: true },
        }),
  ])

  // Group by currency
  function groupByCurrency(items: { amount: number; currency: string }[]): { currency: string; amount: number }[] {
    const map: Record<string, number> = {}
    for (const item of items) {
      map[item.currency] = (map[item.currency] || 0) + item.amount
    }
    return Object.entries(map)
      .filter(([, v]) => v !== 0)
      .map(([currency, amount]) => ({ currency, amount }))
  }

  const overdueByC = groupByCurrency(overdueInvoices.map((i) => ({ amount: Number(i.amountDue), currency: i.currency })))
  const outstandingByC = groupByCurrency(outstandingInvoices.map((i) => ({ amount: Number(i.amountDue), currency: i.currency })))
  const draftByC = groupByCurrency(draftInvoices.map((i) => ({ amount: Number(i.total), currency: i.currency })))

  // Recently updated (D9) — sort by updatedAt so any recent activity (edit,
  // payment, status change) bubbles the invoice to the front, falling back to
  // dateIssued for ties (e.g. fresh seed data).
  const recentInvoices = await prisma.invoice.findMany({
    take: 6,
    where: hideDrafts ? { status: { not: 'draft' } } : undefined,
    orderBy: [{ updatedAt: 'desc' }, { dateIssued: 'desc' }],
    include: {
      client: { select: { firstName: true, lastName: true, organization: true } },
    },
  })

  // Main list with sort (D10)
  const orderByField = ['dateIssued', 'dateDue', 'total', 'invoiceNumber'].includes(sortBy) ? sortBy : 'dateIssued'
  const totalCount = await prisma.invoice.count({ where })
  const totalPages = Math.ceil(totalCount / perPage)

  const [invoices, listTotalsByCurrency] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        client: { select: { firstName: true, lastName: true, organization: true } },
        lineItems: {
          orderBy: { sortOrder: 'asc' },
          take: 1,
          select: { description: true, title: true },
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          take: 1,
          select: { paymentDate: true },
        },
      },
      orderBy: { [orderByField]: sortOrder === 'asc' ? 'asc' : 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.invoice.groupBy({
      by: ['currency'],
      where,
      _sum: { total: true },
    }),
  ])

  const listTotals: [string, number][] = listTotalsByCurrency
    .map((r) => [r.currency, Number(r._sum.total || 0)] as [string, number])
    .filter(([, amt]) => amt !== 0)
    .sort((a, b) => b[1] - a[1])

  function clientDisplayName(client: { firstName: string; lastName: string; organization: string } | null) {
    if (!client) return 'No Client'
    if (client.organization) return client.organization
    return `${client.firstName} ${client.lastName}`.trim() || 'No Client'
  }

  return (
    <div>
      {/* Header (D1) -- "All Invoices" heading + no status tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
        <div className="flex items-center gap-3 flex-wrap" data-print="hide">
          {/* D3: More Actions */}
          <InvoiceMoreActions />
          <PrimaryButton href="/invoices/new">New Invoice</PrimaryButton>
        </div>
      </div>

      {/* D2: From Me / To Me pill toggle — centered below title */}
      <div className="flex justify-center mb-6">
        <PillToggle
          options={[
            { label: 'From Me', value: 'from-me', href: '/invoices?tab=from-me' },
            { label: 'To Me', value: 'to-me', href: '/invoices?tab=to-me' },
          ]}
          active={tab}
        />
      </div>

      {tab === 'to-me' ? (
        /* To Me empty state */
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-gray-400 mb-3">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Invoices To You</h3>
          <p className="text-sm text-gray-500">
            Invoices sent to you will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Stats triplet — synced currency carousel matching /clients */}
          <StatsTripletCarousel
            overdueByC={overdueByC}
            outstandingByC={outstandingByC}
            draftByC={draftByC}
          />

          {/* Recently Updated (D9) — 6 most recent */}
          <InvoiceRecentlyUpdated
            invoices={recentInvoices.slice(0, 6).map((inv) => {
              const d = new Date(inv.updatedAt || inv.dateIssued)
              return {
                id: inv.id,
                clientName: clientDisplayName(inv.client),
                invoiceNumber: formatInvoiceNumber(Number(inv.invoiceNumber)),
                total: formatCurrency(Number(inv.total), inv.currency, {
                  includeCode: false,
                }),
                status: inv.status,
                date: `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`,
              }
            })}
          />

          <InvoicesListSection
            initial={{
              rows: invoices.map((inv) => {
                const first = inv.lineItems[0]
                const lineDesc = first ? first.description || first.title || '' : ''
                return {
                  id: inv.id,
                  invoiceNumber: inv.invoiceNumber,
                  status: inv.status,
                  currency: inv.currency,
                  dateIssued: inv.dateIssued.toISOString(),
                  dateDue: inv.dateDue.toISOString(),
                  description: lineDesc,
                  total: Number(inv.total),
                  amountDue: Number(inv.amountDue),
                  amountPaid: Number(inv.amountPaid),
                  paidDate: inv.payments[0]?.paymentDate.toISOString() ?? null,
                  onlinePaymentsEnabled: inv.onlinePaymentsEnabled,
                  client: inv.client,
                }
              }),
              totalCount,
              totalPages,
              perPage,
              page,
              sortBy: orderByField,
              sortDir: sortOrder === 'asc' ? 'asc' : 'desc',
              totals: listTotals,
            }}
            initialState={{
              page,
              perPage,
              search: search || '',
              sortBy: orderByField as 'dateIssued' | 'dateDue' | 'total' | 'invoiceNumber',
              sortDir: sortOrder === 'asc' ? 'asc' : 'desc',
              advanced: adv,
            }}
          />
        </>
      )}
    </div>
  )
}
