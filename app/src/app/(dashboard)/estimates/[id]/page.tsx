export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatCurrency, formatPlainNumber, formatDate, stripCountryFromAddress } from '@/lib/utils'
import { getCompanySettings } from '@/lib/company'
import StatusBadge from '@/components/ui/StatusBadge'
import PrimaryButton from '@/components/ui/PrimaryButton'
import EstimateActions from '@/components/estimate/EstimateActions'

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const company = await getCompanySettings()

  const estimate = await prisma.estimate.findUnique({
    where: { id },
    include: {
      client: true,
      lineItems: {
        orderBy: { sortOrder: 'asc' },
      },
    },
  })

  if (!estimate) {
    notFound()
  }

  const subtotal = Number(estimate.subtotal)
  const taxAmount = Number(estimate.taxTotal)
  const total = Number(estimate.total)
  const currency = estimate.currency || 'CAD'

  const clientName = [estimate.client.firstName, estimate.client.lastName]
    .filter(Boolean)
    .join(' ')
  const displayName = estimate.client.organization || clientName

  const banner = getStatusBannerConfig(estimate.status)

  // If status is "invoiced", find the linked invoice
  let linkedInvoiceId: string | null = null
  if (estimate.status === 'invoiced') {
    const linkedInvoice = await prisma.invoice.findFirst({
      where: {
        clientId: estimate.clientId,
        total: estimate.total,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    linkedInvoiceId = linkedInvoice?.id ?? null
  }

  // Build client address block for "Prepared For"
  const addressLines = estimate.client.address
    ? stripCountryFromAddress(estimate.client.address).split('\n').filter((l: string) => l.trim())
    : []

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/estimates"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Estimates
        </Link>
      </div>

      {/* Title bar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">
            Estimate {estimate.estimateNumber}
          </h1>
          <StatusBadge status={estimate.status} />
        </div>
        <div className="flex items-center gap-3">
          <EstimateActions
            estimateId={estimate.id}
            shareToken={estimate.shareToken}
            status={estimate.status}
            linkedInvoiceId={linkedInvoiceId}
          />
          <PrimaryButton href={`/estimates/${id}/edit`}>Edit</PrimaryButton>
        </div>
      </div>

      {/* Status banner (G8) */}
      <div className={`${banner.bg} ${banner.text} px-4 py-3 rounded-lg mb-6 text-sm font-medium`}>
        {banner.message}
      </div>

      {/* Estimate document — PORTRAIT CARD (G7) */}
      <div className="max-w-[820px] mx-auto">
        <div className="bg-white rounded-lg border border-gray-200 shadow-md px-12 py-12 md:px-16 md:py-16 mb-6 min-h-[1160px] flex flex-col invoice-preview-card">
          {/* Header */}
          <div className="flex justify-between mb-10">
            <div>
              <h2 className="text-3xl font-black text-[#1A3353] tracking-tight">{company.name.toUpperCase()}</h2>
            </div>
            <div className="text-right text-sm text-gray-600">
              <div className="font-semibold text-gray-900">{company.legalName}</div>
              <div>+1-555-000-0000</div>
              <div>123 Main Street</div>
              <div>Calgary, AB T0A0A0</div>
            </div>
          </div>

          {/* Prepared For + Estimate Meta (G7) */}
          <div className="flex justify-between mb-10">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Prepared For</div>
              <div className="text-sm font-semibold text-gray-900">
                {clientName || displayName}
              </div>
              {estimate.client.organization && clientName && (
                <div className="text-sm text-gray-600">{estimate.client.organization}</div>
              )}
              {addressLines.map((line: string, i: number) => (
                <div key={i} className="text-sm text-gray-600">{line}</div>
              ))}
            </div>
            <div className="text-right">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-2 text-sm">
                <div>
                  <div className="text-gray-500 text-xs mb-1">Estimate Date</div>
                  <div className="font-medium text-gray-900">
                    {formatDate(estimate.dateIssued)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">Estimate Number</div>
                  <div className="font-medium text-gray-900">
                    {estimate.estimateNumber}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs mb-1">Estimate Total ({currency})</div>
                  <div className="font-bold text-gray-900 text-lg">
                    {formatCurrency(total, currency)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Line items table */}
          <table className="w-full mb-6">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-1 text-xs font-medium text-gray-500">
                  Description
                </th>
                <th className="text-right py-1 text-xs font-medium text-gray-500 w-28">
                  Rate
                </th>
                <th className="text-right py-1 text-xs font-medium text-gray-500 w-16">
                  Qty
                </th>
                <th className="text-right py-1 text-xs font-medium text-gray-500 w-28">
                  Line Total
                </th>
              </tr>
            </thead>
            <tbody>
              {estimate.lineItems.map((item) => (
                <tr key={item.id} className="border-b border-gray-100">
                  <td className="py-1 text-sm align-top">
                    <div className="font-medium text-gray-900">{item.title}</div>
                    {item.description && (
                      <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">{item.description}</div>
                    )}
                  </td>
                  <td className="py-1 text-sm text-gray-900 text-right align-top">
                    <div>{formatCurrency(Number(item.rate), currency)}</div>
                    {item.taxCodes.length > 0 && item.taxCodes.map((code) => (
                      <span
                        key={code}
                        className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium"
                      >
                        +{code}
                      </span>
                    ))}
                  </td>
                  <td className="py-1 text-sm text-gray-900 text-right align-top">
                    {Number(item.quantity)}
                  </td>
                  <td className="py-1 text-sm text-gray-900 text-right align-top">
                    {formatCurrency(Number(item.lineTotal), currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals (G7) */}
          <div className="flex justify-end">
            <div className="w-72">
              <div className="flex justify-between py-2 text-sm">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-900">
                  {formatPlainNumber(subtotal)}
                </span>
              </div>
              <div className="flex justify-between py-2 text-sm">
                <span className="text-gray-500">Tax</span>
                <span className="text-gray-900">
                  {formatPlainNumber(taxAmount)}
                </span>
              </div>
              <div className="flex justify-between py-2 text-sm border-t-2 border-gray-900 font-bold">
                <span className="text-gray-900">Estimate Total ({currency})</span>
                <span className="text-gray-900">
                  {formatCurrency(total, currency)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {estimate.notes && (
            <div className="mt-8 pt-6 border-t border-gray-200">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Notes</div>
              <div className="text-sm text-gray-700 whitespace-pre-line">{estimate.notes}</div>
            </div>
          )}

          {/* Terms */}
          {estimate.terms && (
            <div className="mt-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Terms</div>
              <div className="text-sm text-gray-700 whitespace-pre-line">{estimate.terms}</div>
            </div>
          )}

          {/* Thank You */}
          <div className="mt-8 text-center">
            <p className="text-lg font-medium text-gray-400">Thank you</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function getStatusBannerConfig(status: string) {
  const banners: Record<string, { bg: string; text: string; message: string }> = {
    accepted: {
      bg: 'bg-[#D4EDDA]',
      text: 'text-[#155724]',
      message: 'Accepted -- Your client has accepted this estimate.',
    },
    declined: {
      bg: 'bg-[#FDECEA]',
      text: 'text-[#BF2600]',
      message: 'Declined -- Your client has declined this estimate.',
    },
    sent: {
      bg: 'bg-[#E3F0FF]',
      text: 'text-[#0075DD]',
      message: 'Sent -- This estimate has been sent to your client.',
    },
    viewed: {
      bg: 'bg-[#FFF3CC]',
      text: 'text-[#7A5C00]',
      message: 'Viewed -- Your client has viewed this estimate.',
    },
    invoiced: {
      bg: 'bg-[#D4EDDA]',
      text: 'text-[#155724]',
      message: 'Invoiced -- You sent an invoice for this estimate.',
    },
    draft: {
      bg: 'bg-[#E8E8E8]',
      text: 'text-[#666666]',
      message: 'Draft -- This estimate has not been sent yet.',
    },
  }
  return banners[status] || banners.draft
}
