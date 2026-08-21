import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { stripe, isAllowedCurrency, toStripeAmount } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  if (!stripe) {
    return NextResponse.json(
      { error: 'Stripe is not configured on the server' },
      { status: 500 }
    )
  }

  let body: { shareToken?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { shareToken } = body
  if (!shareToken) {
    return NextResponse.json({ error: 'Missing shareToken' }, { status: 400 })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { shareToken },
    include: { client: true },
  })

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  if (!invoice.onlinePaymentsEnabled) {
    return NextResponse.json(
      { error: 'Online payments are not enabled for this invoice' },
      { status: 403 }
    )
  }

  if (!isAllowedCurrency(invoice.currency)) {
    return NextResponse.json(
      { error: `Currency ${invoice.currency} is not supported for online payments` },
      { status: 400 }
    )
  }

  const amountDue = Number(invoice.amountDue)
  if (amountDue <= 0) {
    return NextResponse.json(
      { error: 'Invoice has no outstanding balance' },
      { status: 400 }
    )
  }

  const chargeAmount = amountDue

  const clientName =
    invoice.client.organization ||
    [invoice.client.firstName, invoice.client.lastName].filter(Boolean).join(' ')

  const suffix = `Inv ${invoice.invoiceNumber}`
    .replace(/[<>\\'"*]/g, '')
    .slice(0, 22)

  const intent = await stripe.paymentIntents.create({
    amount: toStripeAmount(chargeAmount),
    currency: invoice.currency.toLowerCase(),
    payment_method_types: ['card'],
    description: `Invoice ${invoice.invoiceNumber}`,
    statement_descriptor_suffix: suffix,
    receipt_email: invoice.client.email || undefined,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      shareToken,
      clientId: invoice.clientId,
      clientName,
    },
  })

  return NextResponse.json({
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
  })
}
