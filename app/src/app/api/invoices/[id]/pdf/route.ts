import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { generatePdf, InvoicePdfData } from '@/lib/pdf'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const token = request.nextUrl.searchParams.get('token')

  let invoice

  if (token) {
    // Public access via share token
    invoice = await prisma.invoice.findFirst({
      where: { id, shareToken: token },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
  } else {
    // Dashboard access - requires auth
    const session = await auth()
    if (!session?.user) {
      return new Response('Unauthorized', { status: 401 })
    }

    invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
  }

  if (!invoice) {
    return new Response('Invoice not found', { status: 404 })
  }

  const clientName = [invoice.client.firstName, invoice.client.lastName]
    .filter(Boolean)
    .join(' ')

  const pdfData: InvoicePdfData = {
    type: 'invoice',
    invoiceNumber: invoice.invoiceNumber,
    reference: invoice.reference || undefined,
    dateIssued: invoice.dateIssued,
    dateDue: invoice.dateDue,
    currency: invoice.currency || 'CAD',
    subtotal: Number(invoice.subtotal),
    discount: Number(invoice.discount),
    taxTotal: Number(invoice.taxTotal),
    total: Number(invoice.total),
    amountPaid: Number(invoice.amountPaid),
    amountDue: Number(invoice.amountDue),
    notes: invoice.notes || undefined,
    terms: invoice.terms || undefined,
    client: {
      clientName: clientName || undefined,
      organization: invoice.client.organization || undefined,
      address: invoice.client.address || undefined,
      vatId: invoice.client.vatId || undefined,
    },
    lineItems: invoice.lineItems.map((item) => ({
      title: item.title,
      description: item.description,
      rate: Number(item.rate),
      quantity: Number(item.quantity),
      lineTotal: Number(item.lineTotal),
      taxCodes: item.taxCodes,
    })),
  }

  const pdfBuffer = await generatePdf(pdfData)
  const uint8 = new Uint8Array(pdfBuffer)

  return new Response(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice_${invoice.invoiceNumber}.pdf"`,
      'Content-Length': pdfBuffer.length.toString(),
    },
  })
}
