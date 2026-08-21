import { NextRequest } from 'next/server'
import JSZip from 'jszip'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { generatePdf, InvoicePdfData } from '@/lib/pdf'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 })
  }

  const idsParam = request.nextUrl.searchParams.get('ids') || ''
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) {
    return new Response('No ids provided', { status: 400 })
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
    orderBy: { invoiceNumber: 'asc' },
  })

  if (invoices.length === 0) {
    return new Response('No invoices found', { status: 404 })
  }

  const items: InvoicePdfData[] = invoices.map((invoice) => {
    const clientName = [invoice.client.firstName, invoice.client.lastName]
      .filter(Boolean)
      .join(' ')
    return {
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
  })

  const pdfs = await Promise.all(items.map((item) => generatePdf(item)))

  const zip = new JSZip()
  const usedNames = new Set<string>()
  pdfs.forEach((buf, i) => {
    const num = items[i].type === 'invoice' ? items[i].invoiceNumber : ''
    const baseName = `Invoice-${num || 'unknown'}`
    let name = `${baseName}.pdf`
    let dedupe = 1
    while (usedNames.has(name)) {
      name = `${baseName}-${++dedupe}.pdf`
    }
    usedNames.add(name)
    zip.file(name, buf)
  })

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })
  const uint8 = new Uint8Array(zipBuffer)

  return new Response(uint8, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="Invoices_${invoices.length}.zip"`,
      'Content-Length': zipBuffer.length.toString(),
    },
  })
}
