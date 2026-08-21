'use client'

export default function PublicInvoiceHeader({
  invoiceNumber,
  invoiceId,
  shareToken,
}: {
  invoiceNumber: string
  invoiceId: string
  shareToken: string
}) {
  const pdfUrl = `/api/invoices/${invoiceId}/pdf?token=${shareToken}`
  return (
    <div className="flex items-center justify-between mb-6 print:hidden">
      <h1 className="text-2xl font-semibold text-[#001B40]">
        Invoice {invoiceNumber}
      </h1>
      <div className="flex items-center gap-4 text-sm">
        <button
          onClick={() => window.print()}
          className="text-[#0075DD] hover:underline font-medium"
        >
          Print
        </button>
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener"
          className="text-[#0075DD] hover:underline font-medium"
        >
          Download PDF
        </a>
      </div>
    </div>
  )
}
