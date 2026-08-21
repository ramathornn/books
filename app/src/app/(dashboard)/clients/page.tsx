export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'

export const metadata: Metadata = { title: 'Clients' }
import Link from 'next/link'
import StatsTripletCarousel from '@/components/ui/StatsTripletCarousel'
import PrimaryButton from '@/components/ui/PrimaryButton'
import ClientListActions from '@/components/client/ClientListActions'
import ClientsListSection, {
  ListPayload,
} from './ClientsListSection'

function clientDisplayName(client: {
  firstName: string
  lastName: string
  organization: string
}) {
  return client.organization || `${client.firstName} ${client.lastName}`.trim()
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const perPageParam = typeof params.perPage === 'string' ? Number(params.perPage) : 50
  const PER_PAGE = [25, 50, 100].includes(perPageParam) ? perPageParam : 50
  const page = Number(params.page) || 1
  const search = typeof params.search === 'string' ? params.search : undefined
  const sortByRaw =
    typeof params.sortBy === 'string' ? params.sortBy : 'outstanding'
  const sortBy: 'name' | 'contact' | 'outstanding' | 'draft' =
    sortByRaw === 'contact' || sortByRaw === 'name' || sortByRaw === 'draft' || sortByRaw === 'outstanding'
      ? (sortByRaw as 'name' | 'contact' | 'outstanding' | 'draft')
      : 'outstanding'
  const defaultDir: 'asc' | 'desc' =
    sortBy === 'outstanding' || sortBy === 'draft' ? 'desc' : 'asc'
  const sortDir: 'asc' | 'desc' =
    params.sort === 'desc' ? 'desc' : params.sort === 'asc' ? 'asc' : defaultDir
  const company = typeof params.company === 'string' ? params.company : undefined
  const contact = typeof params.contact === 'string' ? params.contact : undefined
  const advEmail = typeof params.email === 'string' ? params.email : undefined
  const keyword = typeof params.keyword === 'string' ? params.keyword : undefined

  const now = new Date()

  const where: Record<string, unknown> = {}
  const ANDs: Record<string, unknown>[] = []
  if (search) {
    ANDs.push({
      OR: [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { organization: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ],
    })
  }
  if (company) ANDs.push({ organization: { contains: company, mode: 'insensitive' } })
  if (contact) {
    ANDs.push({
      OR: [
        { firstName: { contains: contact, mode: 'insensitive' } },
        { lastName: { contains: contact, mode: 'insensitive' } },
      ],
    })
  }
  if (advEmail) ANDs.push({ email: { contains: advEmail, mode: 'insensitive' } })
  if (keyword) {
    ANDs.push({
      OR: [
        { internalNote: { contains: keyword, mode: 'insensitive' } },
        { organization: { contains: keyword, mode: 'insensitive' } },
        { firstName: { contains: keyword, mode: 'insensitive' } },
        { lastName: { contains: keyword, mode: 'insensitive' } },
      ],
    })
  }
  if (ANDs.length > 0) where.AND = ANDs

  // H2: Stats — group by currency for carousel tiles
  const [overdueInvoices, outstandingInvoices, draftInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { notIn: ['paid', 'draft'] },
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
    prisma.invoice.findMany({
      where: { status: 'draft' },
      select: { total: true, currency: true },
    }),
  ])

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

  // H3: Recently active clients — ranked by most-recently-updated invoice
  // (the invoice "last opened/edited" signal), falling back to clients with
  // no invoices by their own updatedAt.
  const recentInvoices = await prisma.invoice.findMany({
    orderBy: { updatedAt: 'desc' },
    select: {
      clientId: true,
      updatedAt: true,
    },
    take: 100,
  })
  const clientLastActivity = new Map<string, Date>()
  for (const inv of recentInvoices) {
    if (!clientLastActivity.has(inv.clientId)) {
      clientLastActivity.set(inv.clientId, inv.updatedAt)
    }
  }
  const recentClientIds = Array.from(clientLastActivity.keys()).slice(0, 4)
  const recentClientsUnsorted = await prisma.client.findMany({
    where: { id: { in: recentClientIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      organization: true,
      email: true,
      phone: true,
    },
  })
  const recentClients = recentClientIds
    .map((id) => recentClientsUnsorted.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))

  // Main list with outstanding calculation.
  // Sort A->Z by display name (organization OR "lastName firstName"), case-insensitive.
  // Prisma can't express that compound sort directly, so we fetch all matching clients
  // and sort/paginate in memory (clients are typically small enough for this).
  const totalCount = await prisma.client.count({ where })
  const totalPages = Math.ceil(totalCount / PER_PAGE)

  const allClientsRaw = await prisma.client.findMany({
    where,
    include: {
      invoices: {
        where: { status: { not: 'paid' } },
        select: { amountDue: true, total: true, currency: true, status: true },
      },
    },
  })

  const sortKeyName = (c: {
    organization: string
    lastName: string
    firstName: string
  }) =>
    (c.organization?.trim() ||
      `${c.lastName} ${c.firstName}`.trim() ||
      c.firstName ||
      '')
      .toLowerCase()

  const sortKeyContact = (c: { firstName: string; lastName: string }) =>
    `${c.firstName} ${c.lastName}`.trim().toLowerCase()

  const enriched = allClientsRaw.map((client) => {
    const outstandingByCurrency: Record<string, number> = {}
    const draftByCurrency: Record<string, number> = {}
    let totalOutstanding = 0
    let totalDraft = 0
    for (const inv of client.invoices) {
      if (inv.status === 'draft') {
        const amt = Number(inv.total)
        draftByCurrency[inv.currency] = (draftByCurrency[inv.currency] || 0) + amt
        totalDraft += amt
      } else {
        const amt = Number(inv.amountDue)
        outstandingByCurrency[inv.currency] =
          (outstandingByCurrency[inv.currency] || 0) + amt
        totalOutstanding += amt
      }
    }
    return {
      ...client,
      totalOutstanding,
      totalDraft,
      outstandingByCurrency,
      draftByCurrency,
    }
  })

  enriched.sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'outstanding') {
      if (a.totalOutstanding !== b.totalOutstanding)
        return (a.totalOutstanding - b.totalOutstanding) * dir
      if (a.totalDraft !== b.totalDraft) return b.totalDraft - a.totalDraft
      return sortKeyName(a).localeCompare(sortKeyName(b))
    }
    if (sortBy === 'draft') {
      if (a.totalDraft !== b.totalDraft)
        return (a.totalDraft - b.totalDraft) * dir
      if (a.totalOutstanding !== b.totalOutstanding)
        return b.totalOutstanding - a.totalOutstanding
      return sortKeyName(a).localeCompare(sortKeyName(b))
    }
    const ka = sortBy === 'contact' ? sortKeyContact(a) : sortKeyName(a)
    const kb = sortBy === 'contact' ? sortKeyContact(b) : sortKeyName(b)
    return ka.localeCompare(kb) * dir
  })

  const clients = enriched.slice(
    (page - 1) * PER_PAGE,
    (page - 1) * PER_PAGE + PER_PAGE
  )

  // Footer totals across the current page slice
  const totalOutstandingAll: Record<string, number> = {}
  for (const client of clients) {
    if (!(client.currency in totalOutstandingAll)) {
      totalOutstandingAll[client.currency] = 0
    }
    for (const [c, amt] of Object.entries(client.outstandingByCurrency)) {
      totalOutstandingAll[c] = (totalOutstandingAll[c] || 0) + amt
    }
  }
  const totalRows = Object.entries(totalOutstandingAll).sort(
    (a, b) => b[1] - a[1]
  ) as [string, number][]

  const initialPayload: ListPayload = {
    rows: clients.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      organization: c.organization,
      internalNote: c.internalNote,
      currency: c.currency,
      outstandingByCurrency: c.outstandingByCurrency,
      draftByCurrency: c.draftByCurrency,
    })),
    totalCount,
    totalPages,
    perPage: PER_PAGE,
    page,
    sortBy,
    sortDir,
    totals: totalRows,
  }

  const initialState = {
    page,
    perPage: PER_PAGE,
    search: search || '',
    sortBy,
    sortDir,
    filters: {
      company: company || '',
      contact: contact || '',
      email: advEmail || '',
      keyword: keyword || '',
      field: typeof params.field === 'string' ? params.field : 'all',
    },
  }

  return (
    <div>
      {/* H1: Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1>Clients</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <ClientListActions />
          <PrimaryButton href="/clients/new">New Client</PrimaryButton>
        </div>
      </div>

      {/* 5C: Sub-tabs — Clients (active) | Self-Employed (disabled-looking) */}
      <div className="mb-6">
        <div className="inline-flex border border-gray-300 rounded-full p-0.5">
          <span className="px-5 py-1.5 rounded-full text-sm font-medium bg-[#0075DD] text-white">
            Clients
          </span>
          <span
            className="px-5 py-1.5 rounded-full text-sm font-medium text-gray-400 bg-white cursor-not-allowed"
            title="Coming soon"
          >
            Self-Employed
          </span>
        </div>
      </div>

      {/* H2: Stats bar with currency carousel */}
      <StatsTripletCarousel
        overdueByC={overdueByC}
        outstandingByC={outstandingByC}
        draftByC={draftByC}
      />

      {/* H3: Recently Active */}
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[#001B40] mb-3">
          Recently Active
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {recentClients.slice(0, 4).map((client, i) => {
            const name = clientDisplayName(client)
            const initials =
              (
                (client.firstName?.[0] || client.organization?.[0] || '?') +
                (client.lastName?.[0] || client.organization?.[1] || '')
              ).toUpperCase()
            const palette = [
              { bar: '#B28EFA', text: '#6A3EC7', bg: '#F3EDFE' },
              { bar: '#4CB3FF', text: '#0075DD', bg: '#E6F4FF' },
              { bar: '#F0627E', text: '#C93E57', bg: '#FDECEF' },
              { bar: '#F5B844', text: '#A7740C', bg: '#FEF4E1' },
            ]
            const color = palette[i % palette.length]
            return (
              <Link
                key={client.id}
                href={`/clients/${client.id}`}
                className="relative h-full bg-white rounded-lg border border-[#E1E6EB] px-5 pt-6 pb-5 hover:shadow-sm transition-shadow flex flex-col overflow-hidden"
              >
                <span
                  className="absolute top-0 left-0 right-0 h-1"
                  style={{ backgroundColor: color.bar }}
                />
                <div className="flex items-center gap-4">
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold flex-shrink-0"
                    style={{ backgroundColor: color.bg, color: color.text }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-semibold text-[#001B40] leading-tight">
                      {`${client.firstName || ''} ${client.lastName || ''}`.trim() || client.organization || name}
                    </div>
                    {client.organization && (client.firstName || client.lastName) && (
                      <div className="truncate text-sm text-[#576981] mt-0.5">
                        {client.organization}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2 text-sm text-[#576981] truncate min-h-[20px]">
                  {client.email && (
                    <>
                      <svg
                        className="w-4 h-4 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M3 8l9 6 9-6M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                      <span className="truncate">{client.email}</span>
                    </>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      </div>

      {/* Tab bar — Clients / Sent Emails */}
      <div className="border-b border-[#E1E6EB] mb-4">
        <div className="flex gap-6">
          <span className="px-1 pb-2 text-sm font-semibold text-[#001B40] border-b-2 border-[#0075DD] -mb-px">
            Clients
          </span>
          <span
            className="px-1 pb-2 text-sm text-[#576981] cursor-not-allowed"
            title="Coming soon"
          >
            Sent Emails
          </span>
        </div>
      </div>

      <ClientsListSection
        initial={initialPayload}
        initialState={initialState}
      />

      {/* View Archived Clients link */}
      <div className="mt-6 text-center">
        <button className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
          View Archived Clients
        </button>
      </div>
    </div>
  )
}
