export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import Link from 'next/link'
import PaymentMoreActions from './PaymentMoreActions'
import PaymentsListSection from './PaymentsListSection'

export const metadata: Metadata = {
  title: 'Payments',
}

const DEFAULT_PER_PAGE = 40

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const perPage = Number(params.perPage) || DEFAULT_PER_PAGE
  const search = typeof params.search === 'string' ? params.search : undefined
  const tab = typeof params.tab === 'string' ? params.tab : 'invoice'

  // Advanced filters from URL (so SSR matches client state)
  const adv = {
    clientId: typeof params.clientId === 'string' ? params.clientId : '',
    paymentMethod:
      typeof params.paymentMethod === 'string' ? params.paymentMethod : '',
    source: typeof params.source === 'string' ? params.source : '',
    dateFrom: typeof params.dateFrom === 'string' ? params.dateFrom : '',
    dateTo: typeof params.dateTo === 'string' ? params.dateTo : '',
    amountMin: typeof params.amountMin === 'string' ? params.amountMin : '',
    amountMax: typeof params.amountMax === 'string' ? params.amountMax : '',
    currency: typeof params.currency === 'string' ? params.currency : '',
    keyword: typeof params.keyword === 'string' ? params.keyword : '',
  }

  // Build where clause
  const andClauses: Record<string, unknown>[] = []
  if (search) {
    andClauses.push({
      OR: [
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { client: { organization: { contains: search, mode: 'insensitive' } } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      ],
    })
  }

  if (adv.clientId) andClauses.push({ clientId: adv.clientId })
  if (adv.paymentMethod) andClauses.push({ paymentMethod: adv.paymentMethod })
  if (adv.source) andClauses.push({ source: adv.source })
  if (adv.currency) andClauses.push({ currency: adv.currency })

  if (adv.dateFrom || adv.dateTo) {
    const range: Record<string, Date> = {}
    if (adv.dateFrom) range.gte = new Date(adv.dateFrom)
    if (adv.dateTo) range.lte = new Date(adv.dateTo)
    andClauses.push({ paymentDate: range })
  }

  if (adv.amountMin || adv.amountMax) {
    const range: Record<string, number> = {}
    if (adv.amountMin) range.gte = Number(adv.amountMin)
    if (adv.amountMax) range.lte = Number(adv.amountMax)
    andClauses.push({ amount: range })
  }

  if (adv.keyword) {
    andClauses.push({
      OR: [
        { notes: { contains: adv.keyword, mode: 'insensitive' } },
        {
          stripePaymentIntentId: {
            contains: adv.keyword,
            mode: 'insensitive',
          },
        },
      ],
    })
  }

  const where: Record<string, unknown> =
    andClauses.length > 0 ? { AND: andClauses } : {}

  const [payments, totalCount] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        client: true,
        invoice: true,
      },
      orderBy: { paymentDate: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.payment.count({ where }),
  ])

  const totalPages = Math.ceil(totalCount / perPage)

  return (
    <div>
      {/* Header -- K1: no upsell card */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Payments</h1>
        <div className="flex items-center gap-3" data-print="hide">
          {/* K3: More Actions dropdown */}
          <PaymentMoreActions />
        </div>
      </div>

      {/* 7B: Sub-tabs: Invoice Payments (active) | Third Party Payments (disabled) | Other Income (disabled) */}
      <div className="mb-6 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          <Link
            href="/payments?tab=invoice"
            className={`border-b-2 pb-3 text-sm font-medium ${
              tab === 'invoice'
                ? 'border-[#0075DD] text-[#0075DD]'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            Invoice Payments
          </Link>
          <span
            aria-disabled="true"
            className="border-b-2 border-transparent pb-3 text-sm font-medium text-gray-300 cursor-not-allowed"
          >
            Third Party Payments
          </span>
          <span
            aria-disabled="true"
            className="border-b-2 border-transparent pb-3 text-sm font-medium text-gray-300 cursor-not-allowed"
          >
            Other Income
          </span>
        </nav>
      </div>

      <PaymentsListSection
        initial={{
          rows: payments.map((payment) => ({
            id: payment.id,
            paymentDate: payment.paymentDate.toISOString(),
            paymentMethod: payment.paymentMethod,
            amount: String(payment.amount),
            currency: payment.currency,
            notes: payment.notes,
            status: payment.status,
            invoiceId: payment.invoiceId,
            client: {
              firstName: payment.client.firstName,
              lastName: payment.client.lastName,
              organization: payment.client.organization,
            },
            invoice: payment.invoice
              ? {
                  id: payment.invoice.id,
                  invoiceNumber: payment.invoice.invoiceNumber,
                }
              : null,
          })),
          totalCount,
          totalPages,
          perPage,
          page,
          sortBy: 'paymentDate',
          sortDir: 'desc',
        }}
        initialState={{
          page,
          perPage,
          search: search || '',
          sortBy: 'paymentDate',
          sortDir: 'desc',
          advanced: adv,
        }}
      />
    </div>
  )
}
