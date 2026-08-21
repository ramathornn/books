import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { getBaseUrl } from '@/lib/utils'
import { getEmailProvider } from '@/lib/emailProvider'
import { sendInvoiceEmail } from '@/lib/email'
import { generatePdf, InvoicePdfData } from '@/lib/pdf'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const body = await request.json()
    const to: string[] = Array.isArray(body.to)
      ? Array.from(new Set(body.to.map((e: unknown) => String(e).trim().toLowerCase())))
      : []
    const cc: string[] = Array.isArray(body.cc)
      ? Array.from(
          new Set(body.cc.map((e: unknown) => String(e).trim().toLowerCase()))
        ).filter((e): e is string => typeof e === 'string' && !to.includes(e))
      : []
    const message: string = typeof body.message === 'string' ? body.message : ''
    const subject: string = typeof body.subject === 'string' ? body.subject : ''
    const attachPdf: boolean = body.attachPdf !== false

    if (to.length === 0) {
      return Response.json({ error: 'At least one recipient is required' }, { status: 400 })
    }
    if (to.length + cc.length > 10) {
      return Response.json({ error: 'Too many recipients (max 10)' }, { status: 400 })
    }
    const invalid = [...to, ...cc].find((e) => !EMAIL_RE.test(e))
    if (invalid) {
      return Response.json({ error: `Invalid email address: ${invalid}` }, { status: 400 })
    }

    if (!getEmailProvider()) {
      return Response.json(
        { error: 'Email is not configured. Set EMAIL_PROVIDER and related keys in your environment.' },
        { status: 503 }
      )
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
      },
    })
    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    let pdfBuffer: Buffer | null = null
    if (attachPdf) {
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
      pdfBuffer = await generatePdf(pdfData)
    }

    const isOverdue =
      !!invoice.dateDue &&
      !['paid', 'void', 'archived', 'bad_debt', 'refunded'].includes(invoice.status) &&
      new Date(invoice.dateDue) < new Date()

    const sent = await sendInvoiceEmail({
      to,
      cc,
      subject,
      message,
      invoiceNumber: invoice.invoiceNumber,
      amountDue: Number(invoice.amountDue).toFixed(2),
      currency: invoice.currency,
      dateDue: invoice.dateDue
        ? new Date(invoice.dateDue).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })
        : null,
      isOverdue,
      shareUrl: `${getBaseUrl()}/invoice/${invoice.shareToken}`,
      attachment: pdfBuffer
        ? {
            filename: `Invoice_${invoice.invoiceNumber}.pdf`,
            content: pdfBuffer,
          }
        : undefined,
    })

    if (!sent) {
      return Response.json({ error: 'Failed to send email' }, { status: 502 })
    }

    await prisma.invoiceActivity.create({
      data: {
        invoiceId: id,
        type: 'emailed',
        description: `Invoice emailed to ${to.join(', ')}${cc.length > 0 ? ` (cc: ${cc.join(', ')})` : ''}`,
      },
    })

    return Response.json({ ok: true, to, cc })
  } catch (error) {
    console.error('Send invoice email error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
