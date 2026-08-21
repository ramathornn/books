import {
  formatCurrency,
  formatPlainNumber,
  formatInvoiceNumber,
  formatDate,
  stripCountryFromAddress,
} from '@/lib/utils'
import type { CompanyInfo } from '@/lib/company'

export interface InvoiceCardData {
  invoiceNumber: number | string | { toString(): string }
  reference: string | null
  dateIssued: Date | string
  dateDue: Date | string
  currency: string
  subtotal: number | string | { toString(): string }
  discount: number | string | { toString(): string }
  taxTotal: number | string | { toString(): string }
  total: number | string | { toString(): string }
  amountPaid: number | string | { toString(): string }
  amountDue: number | string | { toString(): string }
  notes: string | null
  terms: string | null
  client: {
    firstName: string | null
    lastName: string | null
    organization: string | null
    address: string | null
    vatId: string | null
  }
  lineItems: Array<{
    id: string
    title: string
    description: string | null
    rate: number | string | { toString(): string }
    quantity: number | string | { toString(): string }
    lineTotal: number | string | { toString(): string }
    taxCodes: string[]
  }>
}

export default function InvoiceCard({ invoice, company }: { invoice: InvoiceCardData; company: CompanyInfo }) {
  const clientName = [invoice.client.firstName, invoice.client.lastName]
    .filter(Boolean)
    .join(' ')
  const displayName = invoice.client.organization || clientName || 'Client'
  const invoiceNumDisplay = formatInvoiceNumber(Number(invoice.invoiceNumber))

  const uniqueTaxCodes = Array.from(
    new Set(invoice.lineItems.flatMap((li) => li.taxCodes))
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

  return (
    <div className="bg-white shadow-md rounded-sm px-4 py-8 sm:px-12 sm:py-12 lg:px-16 lg:py-16 print:shadow-none print:px-0 print:py-0 min-h-[1160px] flex flex-col invoice-preview-card">
      {/* Logo + business address */}
      <div className="flex flex-col sm:flex-row sm:justify-between gap-4 sm:gap-0 mb-8 sm:mb-10">
        <div>
          {company.name.split(/\s+/).slice(0, 2).map((word, i) => (
            <div
              key={i}
              className="text-2xl sm:text-3xl font-black text-[#1A3353] tracking-tight leading-none"
            >
              {word.toUpperCase()}
            </div>
          ))}
        </div>
        <div className="sm:text-right text-sm text-gray-600">
          <div className="font-semibold text-gray-900">{company.legalName}</div>
          {company.phone && <div>{company.phone}</div>}
          {company.addressMultiLine.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      </div>

      {/* 4-column meta grid (stacks on mobile, 2-col on sm, 4-col on md+) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-10 gap-y-4 mb-10">
        <div>
          <div className="text-sm font-medium text-[#0075DD] mb-1">Billed To</div>
          {invoice.client.organization ? (
            <>
              <div className="text-sm font-semibold text-gray-900">{invoice.client.organization}</div>
              {clientName && (
                <div className="text-sm text-gray-600">{clientName}</div>
              )}
            </>
          ) : (
            <div className="text-sm font-semibold text-gray-900">{clientName || displayName}</div>
          )}
          {invoice.client.address && (
            <div className="text-sm text-gray-600 whitespace-pre-line">
              {stripCountryFromAddress(invoice.client.address)}
            </div>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-[#0075DD] mb-1">Date of Issue</div>
          <div className="text-sm text-gray-900">{formatDate(invoice.dateIssued)}</div>
          <div className="text-sm font-medium text-[#0075DD] mt-4 mb-1">Due Date</div>
          <div className="text-sm text-gray-900">{formatDate(invoice.dateDue)}</div>
          {invoice.client.vatId && (
            <>
              <div className="text-sm font-medium text-[#0075DD] mt-4 mb-1">VAT ID</div>
              <div className="text-sm text-gray-900">{invoice.client.vatId}</div>
            </>
          )}
        </div>

        <div>
          <div className="text-sm font-medium text-[#0075DD] mb-1">Invoice Number</div>
          <div className="text-sm text-gray-900">{invoiceNumDisplay}</div>
          <div className="text-sm font-medium text-[#0075DD] mt-4 mb-1">Reference</div>
          <div className="text-sm text-gray-900">{invoice.reference || '\u2014'}</div>
        </div>

        <div>
          <div className="text-sm font-medium text-[#0075DD] mb-1">
            Amount Due ({invoice.currency})
          </div>
          <div className="text-[25px] font-normal text-[#001B40] leading-tight whitespace-nowrap">
            {formatCurrency(Number(invoice.amountDue), invoice.currency, { includeCode: false })}
          </div>
        </div>
      </div>

      {/* Gradient separator */}
      <div className="h-[3px] bg-gradient-to-r from-[#1A3353] to-[#2FA84F] my-6" />

      {/* Line items */}
      <table className="w-full mb-8">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left py-2 text-sm font-normal text-[#0075DD]">
              Description
            </th>
            <th className="text-right py-2 text-sm font-normal text-[#0075DD] w-28">
              Rate
            </th>
            <th className="text-right py-2 text-sm font-normal text-[#0075DD] w-16">
              Qty
            </th>
            <th className="text-right py-2 text-sm font-normal text-[#0075DD] w-28">
              Line Total
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.id} className="border-b border-gray-100">
              <td className="py-3 text-sm align-top">
                <div className="font-medium text-gray-900">{item.title}</div>
                {item.description && (
                  <div className="text-xs text-gray-500 mt-0.5 whitespace-pre-line">
                    {item.description}
                  </div>
                )}
              </td>
              <td className="py-3 text-sm text-gray-900 text-right align-top">
                <div>
                  {formatCurrency(Number(item.rate), invoice.currency, { includeCode: false })}
                </div>
                {item.taxCodes.length > 0 &&
                  item.taxCodes.map((code) => (
                    <span
                      key={code}
                      className="inline-block mt-1 text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium"
                    >
                      {(() => {
                        const [name, rate] = code.split(':')
                        return rate ? `${name} ${rate}%` : name
                      })()}
                    </span>
                  ))}
              </td>
              <td className="py-3 text-sm text-gray-900 text-right align-top">
                {Number(item.quantity)}
              </td>
              <td className="py-3 text-sm text-gray-900 text-right align-top">
                {formatCurrency(Number(item.lineTotal), invoice.currency, { includeCode: false })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-72">
          <div className="flex justify-between py-2 text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="text-gray-900">
              {formatPlainNumber(Number(invoice.subtotal))}
            </span>
          </div>
          {Number(invoice.discount) > 0 && (
            <div className="flex justify-between py-2 text-sm">
              <span className="text-gray-500">Discount</span>
              <span className="text-gray-900">
                -{formatPlainNumber(Number(invoice.discount))}
              </span>
            </div>
          )}
          <div className="flex justify-between py-2 text-sm">
            <span className="text-gray-500">{taxLabel}</span>
            <span className="text-gray-900">
              {formatPlainNumber(Number(invoice.taxTotal))}
            </span>
          </div>
          <div className="flex justify-between py-2 text-sm border-t border-gray-200 font-semibold">
            <span className="text-gray-900">Total</span>
            <span className="text-gray-900">
              {formatPlainNumber(Number(invoice.total))}
            </span>
          </div>
          <div className="flex justify-between py-2 text-sm">
            <span className="text-gray-500">Amount Paid</span>
            <span className="text-gray-900">
              {formatPlainNumber(Number(invoice.amountPaid))}
            </span>
          </div>
          <div className="flex justify-between py-2 text-sm border-t-2 border-gray-900 font-bold">
            <span className="text-[#0075DD]">Amount Due ({invoice.currency})</span>
            <span className="text-gray-900">
              {formatCurrency(Number(invoice.amountDue), invoice.currency, { includeCode: false })}
            </span>
          </div>
        </div>
      </div>

      {/* Notes & Terms */}
      {invoice.notes && (
        <div className="mt-8 pt-6 border-t border-gray-200">
          <div className="text-xs font-medium text-[#2FA84F] tracking-wider mb-1">
            Notes
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-line">
            {invoice.notes}
          </div>
        </div>
      )}
      {invoice.terms && (
        <div className="mt-4">
          <div className="text-xs font-medium text-[#2FA84F] tracking-wider mb-1">
            Terms
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-line">
            {invoice.terms}
          </div>
        </div>
      )}
    </div>
  )
}
