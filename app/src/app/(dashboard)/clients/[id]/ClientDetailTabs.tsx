'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import StatusBadge from '@/components/ui/StatusBadge'

interface SerializedInvoice {
  id: string
  invoiceNumber: string
  description: string
  dateDue: string
  dateIssued: string
  total: number
  amountDue: number
  status: string
  currency: string
  formattedDueDate: string
  relativeDue: string
  formattedAmount: string
  formattedInvoiceNumber: string
}

interface SerializedEstimate {
  id: string
  estimateNumber: string
  description: string
  dateIssued: string
  total: number
  status: string
  currency: string
  formattedDate: string
  formattedAmount: string
  formattedEstimateNumber: string
}

interface ContactInfo {
  firstName: string
  lastName: string
  organization: string
  email: string
  phone: string
  addressLines: string[]
  initials: string
  avatarColor: string
}

interface Props {
  clientId: string
  clientName: string
  invoices: SerializedInvoice[]
  estimates: SerializedEstimate[]
  contactInfo: ContactInfo
}

// I5: Tab row
const tabConfig = [
  { key: 'Invoices', enabled: true },
  { key: 'Recurring Templates', enabled: false },
  { key: 'Credits', enabled: true },
  { key: 'Retainer', enabled: false },
  { key: 'Checkout Links', enabled: false },
  { key: 'Expenses', enabled: false },
  { key: 'Estimates', enabled: true },
] as const

type ActiveTab = 'Invoices' | 'Credits' | 'Estimates'

export default function ClientDetailTabs({
  clientId,
  clientName,
  invoices,
  estimates,
  contactInfo,
}: Props) {
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<ActiveTab>('Invoices')
  const [outstandingOnly, setOutstandingOnly] = useState(false)

  useEffect(() => {
    if (searchParams.get('tab') === 'outstanding') {
      setActiveTab('Invoices')
      setOutstandingOnly(true)
    }
  }, [searchParams])

  const filteredInvoices = outstandingOnly
    ? invoices.filter((inv) => inv.amountDue > 0 && inv.status !== 'paid' && inv.status !== 'draft')
    : invoices

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-6 mb-6 border-b border-gray-200 overflow-x-auto">
        {tabConfig.map((tab) => {
          if (!tab.enabled) {
            return (
              <span
                key={tab.key}
                className="pb-3 text-sm font-medium whitespace-nowrap text-gray-300 cursor-not-allowed"
                title="Coming soon"
              >
                {tab.key}
              </span>
            )
          }
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as ActiveTab)}
              className={`pb-3 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key
                  ? 'text-[#2FA84F] border-b-2 border-[#2FA84F]'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.key}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'Invoices' && (
        <>
          {outstandingOnly && (
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFF4E0] text-[#8F5E00] font-medium">
                Outstanding only
                <button
                  type="button"
                  onClick={() => setOutstandingOnly(false)}
                  className="hover:text-[#001B40]"
                  aria-label="Clear filter"
                >
                  ×
                </button>
              </span>
            </div>
          )}
          <InvoicesTab
            clientName={clientName}
            clientId={clientId}
            invoices={filteredInvoices}
          />
        </>
      )}
      {activeTab === 'Estimates' && (
        <EstimatesTab
          clientName={clientName}
          clientId={clientId}
          estimates={estimates}
        />
      )}
      {activeTab === 'Credits' && (
        <CreditsTab clientName={clientName} />
      )}
    </div>
  )
}

function InvoicesTab({
  clientName,
  clientId,
  invoices,
}: {
  clientName: string
  clientId: string
  invoices: SerializedInvoice[]
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Invoices for {clientName}
        </h3>
        <Link
          href={`/invoices/new?clientId=${clientId}`}
          className="text-sm text-[#2FA84F] hover:underline"
        >
          + New Invoice
        </Link>
      </div>
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Client / Invoice #
            </th>
            <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Description
            </th>
            <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Due Date
            </th>
            <th className="px-4 py-1 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Amount / Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {invoices.length === 0 ? (
            <tr>
              <td
                colSpan={4}
                className="px-4 py-8 text-center text-sm text-gray-500"
              >
                No invoices for this client.
              </td>
            </tr>
          ) : (
            invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50">
                <td className="px-4 py-1">
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="block hover:text-[#2FA84F]"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {clientName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {inv.formattedInvoiceNumber}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-1 text-sm text-gray-500 truncate max-w-xs">
                  {inv.description}
                </td>
                <td className="px-4 py-1">
                  <div className="text-sm text-gray-900">
                    {inv.formattedDueDate}
                  </div>
                  <div className="text-xs text-gray-500">{inv.relativeDue}</div>
                </td>
                <td className="px-4 py-1 text-right">
                  <div className="text-sm font-medium text-gray-900">
                    {inv.formattedAmount}
                  </div>
                  <div className="mt-1">
                    <StatusBadge
                      status={
                        inv.status !== 'paid' &&
                        inv.status !== 'draft' &&
                        inv.status !== 'refunded' &&
                        inv.status !== 'archived' &&
                        inv.dateDue &&
                        new Date(inv.dateDue) < new Date()
                          ? 'overdue'
                          : inv.status
                      }
                    />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function EstimatesTab({
  clientName,
  clientId,
  estimates,
}: {
  clientName: string
  clientId: string
  estimates: SerializedEstimate[]
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">
          Estimates for {clientName}
        </h3>
        <Link
          href={`/estimates/new?clientId=${clientId}`}
          className="text-sm text-[#2FA84F] hover:underline"
        >
          + New Estimate
        </Link>
      </div>
      <table className="w-full">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Client / Estimate #
            </th>
            <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Description
            </th>
            <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Date
            </th>
            <th className="px-4 py-1 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Amount / Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {estimates.length === 0 ? (
            <tr>
              <td
                colSpan={4}
                className="px-4 py-8 text-center text-sm text-gray-500"
              >
                No estimates for this client.
              </td>
            </tr>
          ) : (
            estimates.map((est) => (
              <tr key={est.id} className="hover:bg-gray-50">
                <td className="px-4 py-1">
                  <Link
                    href={`/estimates/${est.id}`}
                    className="block hover:text-[#2FA84F]"
                  >
                    <div className="text-sm font-medium text-gray-900">
                      {clientName}
                    </div>
                    <div className="text-xs text-gray-500">
                      {est.formattedEstimateNumber}
                    </div>
                  </Link>
                </td>
                <td className="px-4 py-1 text-sm text-gray-500 truncate max-w-xs">
                  {est.description}
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  {est.formattedDate}
                </td>
                <td className="px-4 py-1 text-right">
                  <div className="text-sm font-medium text-gray-900">
                    {est.formattedAmount}
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={est.status} />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function CreditsTab({ clientName }: { clientName: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
      <div className="text-gray-400 mb-3">
        <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-1">No Credits</h3>
      <p className="text-sm text-gray-500">
        {clientName} has no credits applied.
      </p>
    </div>
  )
}
