export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma'
import { formatCurrency, formatInvoiceNumber } from '@/lib/utils'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import ClientDetailTabs from './ClientDetailTabs'
import ClientDetailHeader from '@/components/client/ClientDetailHeader'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const client = await prisma.client.findUnique({
    where: { id },
    include: {
      invoices: {
        orderBy: { dateIssued: 'desc' },
      },
      estimates: {
        orderBy: { dateIssued: 'desc' },
      },
    },
  })

  if (!client) notFound()

  const clientName =
    client.organization ||
    `${client.firstName} ${client.lastName}`.trim() ||
    'Unknown'

  // Calculate outstanding revenue stats
  const overdueInvoices = client.invoices.filter(
    (inv) => inv.status === 'overdue'
  )
  const outstandingInvoices = client.invoices.filter((inv) =>
    ['sent', 'viewed', 'partial'].includes(inv.status)
  )
  const draftInvoices = client.invoices.filter((inv) => inv.status === 'draft')

  const totalOverdue = overdueInvoices.reduce(
    (sum, inv) => sum + Number(inv.amountDue),
    0
  )
  const totalOutstanding =
    [...overdueInvoices, ...outstandingInvoices].reduce(
      (sum, inv) => sum + Number(inv.amountDue),
      0
    )
  const totalDraft = draftInvoices.reduce(
    (sum, inv) => sum + Number(inv.total),
    0
  )

  // Get initials for avatar
  const initials = (
    (client.firstName?.[0] || '') + (client.lastName?.[0] || '')
  ).toUpperCase() || 'CL'

  // Deterministic color from client name
  const avatarColors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-red-500',
  ]
  const colorIndex =
    (client.firstName.charCodeAt(0) || 0) + (client.lastName.charCodeAt(0) || 0)
  const avatarColor = avatarColors[colorIndex % avatarColors.length]

  // Parse address lines
  const addressLines = client.address
    ? client.address.split('\n').filter((l: string) => l.trim())
    : []

  // Format date helper
  function formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    })
  }

  // Relative date text
  function relativeDateText(date: Date, status: string): string {
    if (status === 'paid' || status === 'refunded' || status === 'archived')
      return '\u2014'
    const now = new Date()
    const due = new Date(date)
    const diffMs = due.getTime() - now.getTime()
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays < 0) return `${Math.abs(diffDays)} days overdue`
    if (diffDays === 0) return 'Due today'
    if (diffDays === 1) return 'Due tomorrow'
    if (diffDays < 30) return `Due in ${diffDays} days`
    const months = Math.round(diffDays / 30)
    return `Due in ${months} month${months > 1 ? 's' : ''}`
  }

  // Serialize data for client component
  const serializedInvoices = client.invoices.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    description: inv.description || '-',
    dateDue: inv.dateDue.toISOString(),
    dateIssued: inv.dateIssued.toISOString(),
    total: Number(inv.total),
    amountDue: Number(inv.amountDue),
    status: inv.status,
    currency: inv.currency,
    formattedDueDate: formatDate(inv.dateDue),
    relativeDue: relativeDateText(inv.dateDue, inv.status),
    formattedAmount: formatCurrency(Number(inv.total), inv.currency),
    formattedInvoiceNumber: formatInvoiceNumber(Number(inv.invoiceNumber)),
  }))

  const serializedEstimates = client.estimates.map((est) => ({
    id: est.id,
    estimateNumber: est.estimateNumber,
    description: est.description || '-',
    dateIssued: est.dateIssued.toISOString(),
    total: Number(est.total),
    status: est.status,
    currency: est.currency,
    formattedDate: formatDate(est.dateIssued),
    formattedAmount: formatCurrency(Number(est.total), est.currency),
    formattedEstimateNumber: formatInvoiceNumber(Number(est.estimateNumber)),
  }))

  const maxBar = Math.max(totalOutstanding, 1)

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/clients"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Clients
        </Link>
      </div>

      {/* I1: Title bar — client name H1 + pencil edit + More Actions + Create New dropdown */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1>{clientName}</h1>
          <Link
            href={`/clients/${id}/edit`}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Edit Client"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <ClientDetailHeader clientId={id} clientName={clientName} />
        </div>
      </div>

      {/* 6C: Sub-tabs */}
      <div className="mb-6 border-b border-gray-200">
        <div className="flex items-center gap-6 overflow-x-auto">
          <span className="pb-3 text-sm font-medium whitespace-nowrap text-[#0075DD] border-b-2 border-[#0075DD]">
            Invoices
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            Recurring Templates
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            Contacts
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            Retainer
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            Credits
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            Checkout Links
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            Expenses
          </span>
          <span
            className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
            title="Coming Soon"
          >
            More
          </span>
        </div>
      </div>

      {/* I2: Overview/Relationship toggle */}
      <div className="mb-6">
        <div className="inline-flex bg-gray-100 rounded-full p-1">
          <button className="px-5 py-1.5 text-sm font-medium rounded-full bg-white text-gray-900 shadow-sm">
            Overview
          </button>
          <button className="px-5 py-1.5 text-sm font-medium rounded-full text-gray-500 hover:text-gray-700">
            Relationship
          </button>
        </div>
      </div>

      {/* I3-I4: Contact Card + Outstanding Revenue */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Contact card — left column */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div
              className={`w-12 h-12 rounded-full ${avatarColor} flex items-center justify-center text-white font-semibold text-base flex-shrink-0`}
            >
              {initials}
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-gray-900">
                {`${client.firstName} ${client.lastName}`.trim()}
              </div>
              {client.organization && (
                <div className="text-sm text-gray-600">{client.organization}</div>
              )}
              {addressLines.map((line: string, i: number) => (
                <div key={i} className="text-sm text-gray-600">
                  {line}
                </div>
              ))}
              {client.email && (
                <div className="text-sm text-gray-600">{client.email}</div>
              )}
              {client.phone && (
                <div className="text-sm text-gray-600">{client.phone}</div>
              )}
            </div>
          </div>
        </div>

        {/* Outstanding Revenue — right column */}
        <div className="bg-white rounded-lg border border-[#0075DD] p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900">
              Outstanding Revenue
            </h3>
            <span className="text-lg font-bold text-[#0075DD]">
              {formatCurrency(totalOutstanding, client.currency)}
            </span>
          </div>

          {/* Horizontal stacked bar chart */}
          <div className="mb-4">
            <div className="h-4 bg-gray-100 rounded-full overflow-hidden flex">
              {totalOverdue > 0 && (
                <div
                  className="h-full bg-[#BF2600]"
                  style={{
                    width: `${(totalOverdue / maxBar) * 100}%`,
                  }}
                />
              )}
              {totalOutstanding - totalOverdue > 0 && (
                <div
                  className="h-full bg-[#FFAB00]"
                  style={{
                    width: `${((totalOutstanding - totalOverdue) / maxBar) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-200">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full bg-[#BF2600]" />
                <span className="text-xs text-gray-500">Overdue</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {formatCurrency(totalOverdue, client.currency)}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />
                <span className="text-xs text-gray-500">In Draft</span>
              </div>
              <div className="text-sm font-semibold text-gray-900">
                {formatCurrency(totalDraft, client.currency)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* I5: Tabs + Content */}
      <ClientDetailTabs
        clientId={id}
        clientName={clientName}
        invoices={serializedInvoices}
        estimates={serializedEstimates}
        contactInfo={{
          firstName: client.firstName,
          lastName: client.lastName,
          organization: client.organization,
          email: client.email,
          phone: client.phone,
          addressLines,
          initials,
          avatarColor,
        }}
      />
    </div>
  )
}
