export const dynamic = 'force-dynamic'

import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { formatCurrency, formatPlainNumber, formatInvoiceNumber, formatDate, stripCountryFromAddress, getBaseUrl } from '@/lib/utils'
import { getCompanySettings } from '@/lib/company'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import InvoiceActions from '@/components/invoice/InvoiceActions'
import ViewHistoryDrawer from '@/components/invoice/ViewHistoryDrawer'
import InvoicePaymentsTable from '@/components/invoice/InvoicePaymentsTable'
import InvoiceCard from '@/components/invoice/InvoiceCard'
import PrimaryButton from '@/components/ui/PrimaryButton'

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const company = await getCompanySettings()

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })

  if (!invoice) notFound()

  // Drafts are hidden from accountant (read-only) sessions.
  if (invoice.status === 'draft') {
    const session = await auth()
    if (session?.user?.role === 'accountant') notFound()
  }

  const clientName = [invoice.client.firstName, invoice.client.lastName]
    .filter(Boolean)
    .join(' ')
  const displayName = invoice.client.organization || clientName || 'No Client'

  const invoiceNumDisplay = formatInvoiceNumber(Number(invoice.invoiceNumber))

  // Query outstanding invoices for this client (excluding this invoice)
  const outstandingInvoices = await prisma.invoice.findMany({
    where: {
      clientId: invoice.clientId,
      id: { not: invoice.id },
      status: { notIn: ['paid', 'draft', 'bad_debt'] },
      amountDue: { gt: 0 },
    },
    select: { amountDue: true, currency: true },
  })

  const outstandingCount = outstandingInvoices.length
  const outstandingTotal = outstandingInvoices.reduce(
    (sum, inv) => sum + Number(inv.amountDue),
    0
  )

  // Status banner config (E4) — palette aligned with StatusBadge
  const statusBanners: Record<
    string,
    { bg: string; text: string; label: string; message: string }
  > = {
    draft: {
      bg: '#E8E8E8',
      text: '#666666',
      label: 'Draft',
      message: `You created this invoice on ${formatDate(invoice.createdAt)}.`,
    },
    sent: {
      bg: '#E3F0FF',
      text: '#0075DD',
      label: 'Sent',
      message: `You sent this invoice on ${formatDate(invoice.updatedAt)}.`,
    },
    viewed: {
      bg: '#FFF3CC',
      text: '#7A5C00',
      label: 'Viewed',
      message: `${displayName} viewed this on ${formatDate(invoice.updatedAt)}.`,
    },
    partial: {
      bg: '#FFF0E6',
      text: '#8B4513',
      label: 'Partially Paid',
      message: `${displayName} paid ${formatCurrency(Number(invoice.amountPaid), invoice.currency)} on ${formatDate(invoice.updatedAt)}.`,
    },
    paid: {
      bg: '#D4EDDA',
      text: '#155724',
      label: 'Paid In Full',
      message: `You added a payment on ${formatDate(invoice.updatedAt)}.`,
    },
    overdue: {
      bg: '#FDECEA',
      text: '#BF2600',
      label: 'Overdue',
      message: `This invoice was due on ${formatDate(invoice.dateDue)}.`,
    },
    refunded: {
      bg: '#F3E8FF',
      text: '#6B21A8',
      label: 'Refunded',
      message: `You refunded this invoice on ${formatDate(invoice.updatedAt)}.`,
    },
  }

  const isPastDue =
    invoice.status !== 'paid' &&
    invoice.status !== 'draft' &&
    invoice.status !== 'refunded' &&
    invoice.dateDue &&
    new Date(invoice.dateDue) < new Date()
  const displayStatus = isPastDue ? 'overdue' : invoice.status
  const banner = statusBanners[displayStatus] || statusBanners.draft

  return (
    <div className="print-invoice-page">
      {/* Breadcrumb - hidden on print */}
      <div className="mb-4 print:hidden">
        <Link
          href="/invoices"
          className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Invoices
        </Link>
      </div>

      {/* Title bar - hidden on print */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6 print:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">
            Invoice {invoiceNumDisplay}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <InvoiceActions
            invoiceId={invoice.id}
            shareToken={invoice.shareToken}
            amountDue={Number(invoice.amountDue)}
            currency={invoice.currency}
            invoiceNumber={invoiceNumDisplay}
            status={invoice.status}
            onlinePaymentsEnabled={invoice.onlinePaymentsEnabled}
            appBaseUrl={getBaseUrl()}
            clientEmail={invoice.client.email}
            dateDue={invoice.dateDue.toISOString()}
            companyName={company.legalName}
          />
          <PrimaryButton href={`/invoices/${id}/edit`}>Edit</PrimaryButton>
        </div>
      </div>

      {/* E4: Status Alert Banner (full width, above card) */}
      <div
        className="px-5 py-3 text-sm font-medium flex items-center justify-between print:hidden"
        style={{ backgroundColor: banner.bg, color: banner.text }}
      >
        <span>
          <span className="font-semibold">{banner.label}</span>
          {' \u00b7 '}
          {banner.message}
        </span>
        <ViewHistoryDrawer invoiceId={invoice.id} />
      </div>

      {/* E5: Client Outstanding Banner (full width) */}
      {outstandingCount > 0 && (
        <Link
          href={`/clients/${invoice.clientId}?tab=outstanding`}
          className="bg-yellow-100 text-yellow-800 px-5 py-3 text-sm font-medium flex items-center gap-2 hover:bg-yellow-200 transition-colors print:hidden"
        >
          <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <span className="flex-1">{displayName} has {outstandingCount} outstanding invoice{outstandingCount !== 1 ? 's' : ''} totalling {formatCurrency(outstandingTotal, invoice.currency, { includeCode: false })} {invoice.currency}</span>
          <span className="text-xs underline">View</span>
        </Link>
      )}

      {/* Centered card container */}
      <div className="flex justify-center">
        <div className="w-full max-w-[820px]">

          <InvoiceCard invoice={invoice} company={company} />

          {/* E14: Payments Table Below Card */}
          <InvoicePaymentsTable
            payments={invoice.payments.map((p) => ({
              id: p.id,
              paymentDate: p.paymentDate.toISOString(),
              paymentMethod: p.paymentMethod,
              notes: p.notes,
              amount: Number(p.amount),
            }))}
            invoiceNumber={invoiceNumDisplay}
            invoiceId={invoice.id}
            currency={invoice.currency}
            amountDue={Number(invoice.amountDue)}
            status={invoice.status}
          />
        </div>
      </div>
    </div>
  )
}
