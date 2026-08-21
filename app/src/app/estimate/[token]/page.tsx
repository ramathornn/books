export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { formatCurrency, formatPlainNumber, formatDate, stripCountryFromAddress } from '@/lib/utils'
import EstimateActions from './EstimateActions'
import { getCompanySettings } from '@/lib/company'

export const metadata: Metadata = {
  title: 'Estimate',
}

function formatDateTime(date: Date): string {
  const d = new Date(date)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${mm}/${dd}/${yyyy} ${hh}:${min}`
}

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const company = await getCompanySettings()

  const estimate = await prisma.estimate.findUnique({
    where: { shareToken: token },
    include: {
      client: true,
      lineItems: {
        orderBy: { sortOrder: 'asc' },
      },
      response: true,
    },
  })

  if (!estimate) {
    notFound()
  }

  const subtotal = Number(estimate.subtotal)
  const taxAmount = Number(estimate.taxTotal)
  const total = Number(estimate.total)
  const currency = estimate.currency || 'CAD'

  const uniqueTaxCodes = Array.from(
    new Set(estimate.lineItems.flatMap((li) => li.taxCodes))
  )
  const taxLabel =
    uniqueTaxCodes.length > 0
      ? `Tax (${uniqueTaxCodes
          .map((code) => {
            const [name, rate] = code.split(':')
            return rate ? `${name} ${rate}%` : name
          })
          .join(', ')})`
      : 'Tax'

  const clientName = [estimate.client.firstName, estimate.client.lastName]
    .filter(Boolean)
    .join(' ')
  const displayName = estimate.client.organization || clientName

  // Show accept/decline buttons only if not yet accepted/declined
  const showActions = !['accepted', 'declined', 'invoiced'].includes(
    estimate.status
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-[800px] px-4 py-8 sm:py-12">
        {/* Status banners */}
        {estimate.status === 'accepted' && (
          <div className="mb-6 rounded-lg bg-[#E3FCEF] px-6 py-4 text-center">
            <p className="text-lg font-semibold text-[#006644]">
              Estimate Accepted
            </p>
            {estimate.response && (
              <p className="mt-1 text-sm text-[#006644]">
                Signed by {estimate.response.signerName} on{' '}
                {formatDateTime(estimate.response.createdAt)}
              </p>
            )}
          </div>
        )}
        {estimate.status === 'declined' && (
          <div className="mb-6 rounded-lg bg-[#FFEBE6] px-6 py-4 text-center">
            <p className="text-lg font-semibold text-[#BF2600]">
              Estimate Declined
            </p>
          </div>
        )}
        {estimate.status === 'invoiced' && (
          <div className="mb-6 rounded-lg bg-[#E3F0FF] px-6 py-4 text-center">
            <p className="text-lg font-semibold text-[#0075DD]">
              Invoiced
            </p>
          </div>
        )}

        {/* Accept/Decline buttons */}
        {showActions && <EstimateActions token={token} />}

        {/* Estimate Document — portrait card (matches invoice layout) */}
        <div className="rounded-lg bg-white shadow-md print-invoice-page">
          <div className="p-8 sm:p-12">
            {/* Header */}
            <div className="flex flex-col justify-between gap-6 sm:flex-row">
              <div>
                <h1 className="text-3xl font-black tracking-tight text-[#1A3353]">
                  {company.name.toUpperCase()}
                </h1>
              </div>
              <div className="text-right text-sm text-gray-600">
                <p className="font-semibold text-gray-900">{company.legalName}</p>
                {company.phone && <p>{company.phone}</p>}
                {company.addressMultiLine.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </div>

            {/* Prepared For + Estimate Info */}
            <div className="mt-10 flex flex-col justify-between gap-8 sm:flex-row">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Prepared For
                </p>
                <p className="font-semibold text-gray-900">
                  {clientName || displayName}
                </p>
                {estimate.client.organization && clientName && (
                  <p className="text-sm text-gray-600">
                    {estimate.client.organization}
                  </p>
                )}
                {estimate.client.address && (
                  <p className="text-sm text-gray-600 whitespace-pre-line">
                    {stripCountryFromAddress(estimate.client.address)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Estimate Date
                    </p>
                    <p className="text-sm text-gray-900 mt-1">
                      {formatDate(estimate.dateIssued)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Estimate Number
                    </p>
                    <p className="text-sm text-gray-900 mt-1">
                      {estimate.estimateNumber}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Estimate Total ({currency})
                    </p>
                    <p className="text-lg font-bold text-gray-900 mt-1">
                      {formatCurrency(total, currency)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="mt-8 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="pb-3 text-left font-semibold text-gray-600">
                      Description
                    </th>
                    <th className="pb-3 text-right font-semibold text-gray-600">
                      Rate
                    </th>
                    <th className="pb-3 text-right font-semibold text-gray-600">
                      Qty
                    </th>
                    <th className="pb-3 text-right font-semibold text-gray-600">
                      Line Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {estimate.lineItems.map((item) => (
                    <tr key={item.id} className="border-b border-gray-100">
                      <td className="py-4 pr-4">
                        <div className="font-medium text-gray-900">{item.title}</div>
                        {item.description && (
                          <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">
                            {item.description}
                          </div>
                        )}
                      </td>
                      <td className="py-4 text-right text-gray-700 whitespace-nowrap align-top">
                        <div>{formatCurrency(Number(item.rate), currency)}</div>
                        {item.taxCodes.length > 0 &&
                          item.taxCodes.map((code) => (
                            <span
                              key={code}
                              className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium"
                            >
                              +{code.includes(':') ? `${code}%` : code}
                            </span>
                          ))}
                      </td>
                      <td className="py-4 text-right text-gray-700 align-top">
                        {Number(item.quantity)}
                      </td>
                      <td className="py-4 text-right font-medium text-gray-900 whitespace-nowrap align-top">
                        {formatCurrency(Number(item.lineTotal), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="mt-6 flex justify-end">
              <div className="w-72 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="text-gray-900">
                    {formatPlainNumber(subtotal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">{taxLabel}</span>
                  <span className="text-gray-900">
                    {formatPlainNumber(taxAmount)}
                  </span>
                </div>
                <div className="flex justify-between border-t-2 border-gray-900 pt-2 text-lg font-bold">
                  <span className="text-gray-900">
                    Estimate Total ({currency})
                  </span>
                  <span className="text-gray-900">
                    {formatCurrency(total, currency)}
                  </span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {estimate.notes && (
              <div className="mt-10 border-t border-gray-200 pt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Notes
                </p>
                <p className="text-sm text-gray-600 whitespace-pre-line">
                  {estimate.notes}
                </p>
              </div>
            )}

            {/* Terms */}
            {estimate.terms && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Terms
                </p>
                <p className="text-sm text-gray-600 whitespace-pre-line">
                  {estimate.terms}
                </p>
              </div>
            )}

            {/* Signature block (shown when accepted) */}
            {estimate.status === 'accepted' && estimate.response && (
              <div className="mt-10 border-t border-gray-200 pt-6">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Accepted By
                </p>
                <p className="text-base font-semibold text-gray-900">
                  {estimate.response.signerName}
                </p>
                <p className="text-sm text-gray-600">
                  {estimate.response.signerEmail}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Accepted on {formatDateTime(estimate.response.createdAt)}
                </p>
              </div>
            )}

            {/* Thank You */}
            <div className="mt-10 text-center">
              <p className="text-lg font-medium text-gray-500">Thank you</p>
            </div>
          </div>
        </div>

        {/* Powered by Books footer */}
        <div className="mt-8 text-center text-xs text-gray-400">
          <p>Powered by Books</p>
        </div>
      </div>
    </div>
  )
}
