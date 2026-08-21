import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import prisma from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { sendPaymentReceiptEmail } from '@/lib/email'
import { generatePdf, InvoicePdfData } from '@/lib/pdf'
import { getBaseUrl } from '@/lib/utils'

export const runtime = 'nodejs'

function computeInvoiceStatus(totalPaid: number, invoiceTotal: number): string {
  if (totalPaid <= 0) return 'sent'
  if (totalPaid >= invoiceTotal) return 'paid'
  return 'partial'
}

export async function POST(request: NextRequest) {
  if (!stripe) return new Response('Stripe not configured', { status: 500 })

  const signature = request.headers.get('stripe-signature')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!signature || !secret) {
    return new Response('Missing signature or secret', { status: 400 })
  }

  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('[stripe webhook] signature verification failed', err)
    return new Response('Invalid signature', { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const invoiceId = pi.metadata?.invoiceId
    if (!invoiceId) {
      return new Response('ok', { status: 200 })
    }

    const existing = await prisma.payment.findUnique({
      where: { stripePaymentIntentId: pi.id },
    })
    if (existing) {
      return new Response('ok', { status: 200 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true },
    })
    if (!invoice) return new Response('ok', { status: 200 })

    const amount = pi.amount_received / 100
    const latestCharge =
      typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          paymentDate: new Date(),
          paymentMethod: 'Credit Card',
          amount,
          currency: invoice.currency,
          notes: `Online payment via Stripe (${pi.id})`,
          status: 'paid',
          source: 'stripe',
          stripePaymentIntentId: pi.id,
          stripeChargeId: latestCharge ?? null,
          stripeStatus: pi.status,
          invoiceId: invoice.id,
          clientId: invoice.clientId,
        },
      })

      const newAmountPaid = Number(invoice.amountPaid) + amount
      const newAmountDue = Math.max(0, Number(invoice.total) - newAmountPaid)
      const newStatus = computeInvoiceStatus(newAmountPaid, Number(invoice.total))

      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          status: newStatus,
        },
      })

      await tx.invoiceActivity.create({
        data: {
          invoiceId: invoice.id,
          type: 'payment_added',
          description: `Online payment received via Stripe: ${amount.toFixed(2)} ${invoice.currency}`,
          amount,
        },
      })
    })

    if (invoice.client.email) {
      const shareUrl = `${getBaseUrl()}/invoice/${invoice.shareToken}`
      const clientName =
        invoice.client.organization ||
        [invoice.client.firstName, invoice.client.lastName].filter(Boolean).join(' ') ||
        'Client'

      // Attach the paid invoice as a PDF receipt. Re-fetch so the PDF shows
      // the post-payment amountPaid/amountDue. A PDF failure must not fail
      // the webhook (Stripe would retry and duplicate nothing, but the email
      // would be lost) — fall back to the link-only email.
      let attachment: { filename: string; content: Buffer } | undefined
      try {
        const paid = await prisma.invoice.findUnique({
          where: { id: invoice.id },
          include: { client: true, lineItems: { orderBy: { sortOrder: 'asc' } } },
        })
        if (paid) {
          const pdfData: InvoicePdfData = {
            type: 'invoice',
            invoiceNumber: paid.invoiceNumber,
            reference: paid.reference || undefined,
            dateIssued: paid.dateIssued,
            dateDue: paid.dateDue,
            currency: paid.currency || 'CAD',
            subtotal: Number(paid.subtotal),
            discount: Number(paid.discount),
            taxTotal: Number(paid.taxTotal),
            total: Number(paid.total),
            amountPaid: Number(paid.amountPaid),
            amountDue: Number(paid.amountDue),
            notes: paid.notes || undefined,
            terms: paid.terms || undefined,
            client: {
              clientName:
                [paid.client.firstName, paid.client.lastName].filter(Boolean).join(' ') ||
                undefined,
              organization: paid.client.organization || undefined,
              address: paid.client.address || undefined,
              vatId: paid.client.vatId || undefined,
            },
            lineItems: paid.lineItems.map((item) => ({
              title: item.title,
              description: item.description,
              rate: Number(item.rate),
              quantity: Number(item.quantity),
              lineTotal: Number(item.lineTotal),
              taxCodes: item.taxCodes,
            })),
          }
          attachment = {
            filename: `Receipt_Invoice_${paid.invoiceNumber}.pdf`,
            content: await generatePdf(pdfData),
          }
        }
      } catch (err) {
        console.error('[stripe webhook] receipt PDF generation failed', err)
      }

      await sendPaymentReceiptEmail({
        to: invoice.client.email,
        clientName,
        invoiceNumber: invoice.invoiceNumber,
        amount: amount.toFixed(2),
        currency: invoice.currency,
        paymentDate: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        shareUrl,
        attachment,
      })
    }
  }

  return new Response('ok', { status: 200 })
}
