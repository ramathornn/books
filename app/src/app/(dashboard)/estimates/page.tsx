export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'

export const metadata: Metadata = { title: 'Estimates' }
import { formatCurrency } from '@/lib/utils'
import PillToggle from '@/components/ui/PillToggle'
import RecentDocCard from '@/components/ui/RecentDocCard'
import EstimateListActions, {
  CreateNewEstimateDropdown,
} from '@/components/estimate/EstimateListActions'
import EstimatesListSection from './EstimatesListSection'

const PER_PAGE = 30

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const page = Number(params.page) || 1
  const search = typeof params.search === 'string' ? params.search : undefined
  const tab = typeof params.tab === 'string' ? params.tab : 'from-me'

  // Advanced filters from URL
  const adv = {
    status: typeof params.status === 'string' ? params.status : '',
    clientId: typeof params.clientId === 'string' ? params.clientId : '',
    dateIssuedFrom:
      typeof params.dateIssuedFrom === 'string' ? params.dateIssuedFrom : '',
    dateIssuedTo:
      typeof params.dateIssuedTo === 'string' ? params.dateIssuedTo : '',
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
        { estimateNumber: { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  if (adv.keyword) {
    andClauses.push({
      OR: [
        { estimateNumber: { contains: adv.keyword, mode: 'insensitive' } },
        { description: { contains: adv.keyword, mode: 'insensitive' } },
        { notes: { contains: adv.keyword, mode: 'insensitive' } },
      ],
    })
  }

  if (adv.status) andClauses.push({ status: adv.status })
  if (adv.clientId) andClauses.push({ clientId: adv.clientId })
  if (adv.currency) andClauses.push({ currency: adv.currency })

  if (adv.dateIssuedFrom || adv.dateIssuedTo) {
    const range: Record<string, Date> = {}
    if (adv.dateIssuedFrom) range.gte = new Date(adv.dateIssuedFrom)
    if (adv.dateIssuedTo) range.lte = new Date(adv.dateIssuedTo)
    andClauses.push({ dateIssued: range })
  }

  if (adv.amountMin || adv.amountMax) {
    const range: Record<string, number> = {}
    if (adv.amountMin) range.gte = Number(adv.amountMin)
    if (adv.amountMax) range.lte = Number(adv.amountMax)
    andClauses.push({ total: range })
  }

  const where: Record<string, unknown> =
    andClauses.length > 0 ? { AND: andClauses } : {}

  // Recently updated
  const recentEstimates = await prisma.estimate.findMany({
    take: 6,
    orderBy: [{ dateIssued: 'desc' }, { updatedAt: 'desc' }],
    include: { client: true },
  })

  // Main list
  const totalCount = await prisma.estimate.count({ where })
  const totalPages = Math.ceil(totalCount / PER_PAGE)

  const estimates = await prisma.estimate.findMany({
    where,
    include: {
      client: true,
      lineItems: { take: 1, select: { description: true } },
    },
    orderBy: { dateIssued: 'desc' },
    skip: (page - 1) * PER_PAGE,
    take: PER_PAGE,
  })

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          Estimates and Proposals
        </h1>
        <div className="flex items-center gap-3 flex-wrap" data-print="hide">
          <EstimateListActions />
          <CreateNewEstimateDropdown />
        </div>
      </div>

      {/* From Me / To Me segmented toggle (G2) */}
      <div className="mb-6 flex justify-center">
        <PillToggle
          options={[
            { label: 'From Me', value: 'from-me', href: '/estimates?tab=from-me' },
            { label: 'To Me', value: 'to-me', href: '/estimates?tab=to-me' },
          ]}
          active={tab}
        />
      </div>

      {/* To Me empty state */}
      {tab === 'to-me' ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="text-gray-400 mb-3">
            <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No Estimates To You</h3>
          <p className="text-sm text-gray-500">
            Estimates sent to you will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Recently Updated — 6 most recent, left-most newest (G12) */}
          {!search && page === 1 && recentEstimates.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#001B40]">
                  Recently Updated
                </h2>
              </div>
              <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-6 gap-3 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible snap-x snap-mandatory">
                {recentEstimates.slice(0, 6).map((est) => {
                  const clientName = [est.client.firstName, est.client.lastName]
                    .filter(Boolean)
                    .join(' ')
                  const displayName = est.client.organization || clientName
                  const d = new Date(est.dateIssued)
                  const formattedDate = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
                  return (
                    <div key={est.id} className="flex-shrink-0 w-[140px] sm:w-auto snap-start">
                      <RecentDocCard
                        href={`/estimates/${est.id}`}
                        number={est.estimateNumber}
                        clientName={displayName}
                        date={formattedDate}
                        amount={formatCurrency(Number(est.total), est.currency, {
                          includeCode: false,
                        })}
                        status={est.status}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <EstimatesListSection
            initial={{
              rows: estimates.map((e) => ({
                id: e.id,
                estimateNumber: e.estimateNumber,
                status: e.status,
                currency: e.currency,
                dateIssued: e.dateIssued.toISOString(),
                description: e.lineItems[0]?.description || e.description || '',
                total: Number(e.total),
                client: {
                  firstName: e.client.firstName,
                  lastName: e.client.lastName,
                  organization: e.client.organization,
                },
              })),
              totalCount,
              totalPages,
              perPage: PER_PAGE,
              page,
              sortBy: 'date',
              sortDir: 'desc',
            }}
            initialState={{
              page,
              perPage: PER_PAGE,
              search: search || '',
              sortBy: 'date',
              sortDir: 'desc',
              advanced: adv,
            }}
          />
        </>
      )}

      {/* View Archived */}
      <div className="mt-6 text-center">
        <button className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
          View Archived Estimates and Proposals
        </button>
      </div>
    </div>
  )
}
