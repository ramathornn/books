export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { notFound } from 'next/navigation'
import { formatCurrency, formatDate, formatInvoiceNumber } from '@/lib/utils'
import InvoiceCard from '@/components/invoice/InvoiceCard'
import PublicInvoiceHeader from '@/components/invoice/PublicInvoiceHeader'
import PublicPaymentWidget from '@/components/invoice/PublicPaymentWidget'
import { isAllowedCurrency } from '@/lib/stripe'
import { getCompanySettings } from '@/lib/company'

export const metadata: Metadata = {
  title: 'Invoice',
}

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const company = await getCompanySettings()

  const invoice = await prisma.invoice.findUnique({
    where: { shareToken: token },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })

  if (!invoice) {
    notFound()
  }

  const clientName = [invoice.client.firstName, invoice.client.lastName]
    .filter(Boolean)
    .join(' ')
  const displayName = invoice.client.organization || clientName || 'Client'

  try {
    await prisma.invoiceActivity.create({
      data: {
        invoiceId: invoice.id,
        type: 'viewed',
        description: `${displayName} viewed this invoice.`,
      },
    })
  } catch {
    // Silently fail
  }

  const currency = invoice.currency || 'CAD'
  const amountDue = Number(invoice.amountDue)

  const outstandingInvoices = await prisma.invoice.findMany({
    where: {
      clientId: invoice.clientId,
      id: { not: invoice.id },
      status: { notIn: ['paid', 'draft'] },
      amountDue: { gt: 0 },
    },
    select: { amountDue: true, currency: true },
  })
  const outstandingCount = outstandingInvoices.length
  const outstandingTotal = outstandingInvoices.reduce(
    (sum, inv) => sum + Number(inv.amountDue),
    0
  )

  const isPaid = invoice.status === 'paid' || amountDue <= 0
  const isOverdue =
    invoice.status === 'overdue' ||
    (!isPaid && invoice.dateDue && new Date(invoice.dateDue) < new Date())

  const invoiceNumDisplay = formatInvoiceNumber(Number(invoice.invoiceNumber))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-[820px] px-4 py-8 sm:py-12">
        <PublicInvoiceHeader
          invoiceNumber={invoiceNumDisplay}
          invoiceId={invoice.id}
          shareToken={token}
        />
        {isPaid && (
          <div className="mb-4 rounded-sm bg-[#D4EDDA] px-5 py-3 text-sm font-medium text-[#155724]">
            <span className="font-semibold">Paid In Full</span>
          </div>
        )}
        {isOverdue && !isPaid && (
          <div className="mb-4 rounded-sm bg-[#FDECEA] px-5 py-3 text-sm font-medium text-[#BF2600]">
            <span className="font-semibold">Overdue</span>
            {' \u00b7 '}
            This invoice was due on {formatDate(invoice.dateDue)}.
          </div>
        )}

        {outstandingCount > 0 && (
          <div className="bg-yellow-100 text-yellow-800 px-5 py-3 text-sm font-medium flex items-center gap-2 mb-0">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <span className="flex-1">
              {displayName} has {outstandingCount} outstanding invoice
              {outstandingCount !== 1 ? 's' : ''} totalling{' '}
              {formatCurrency(outstandingTotal, currency, { includeCode: false })} {currency}
            </span>
          </div>
        )}

        {invoice.onlinePaymentsEnabled &&
          !isPaid &&
          amountDue > 0 &&
          isAllowedCurrency(currency) && (
            <PublicPaymentWidget
              shareToken={token}
              invoiceNumber={invoiceNumDisplay}
              currency={currency}
              amountDue={amountDue}
              dateIssued={invoice.dateIssued.toISOString()}
              dateDue={invoice.dateDue.toISOString()}
              businessName={company.legalName}
              publishableKey={process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''}
            />
          )}

        <InvoiceCard invoice={invoice} company={company} />

        <div className="mt-8 text-center text-xs text-gray-400">
          <p>Powered by Books</p>
        </div>
      </div>
    </div>
  )
}
