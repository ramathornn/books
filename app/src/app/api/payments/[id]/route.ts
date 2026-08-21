import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { paymentSchema } from '@/lib/validators'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const payment = await prisma.payment.findUnique({
    where: { id },
    include: {
      invoice: {
        select: { id: true, invoiceNumber: true, total: true, amountPaid: true, amountDue: true },
      },
      client: {
        select: { id: true, firstName: true, lastName: true, organization: true },
      },
    },
  })

  if (!payment) {
    return Response.json({ error: 'Payment not found' }, { status: 404 })
  }

  return Response.json(payment)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  try {
    const existing = await prisma.payment.findUnique({
      where: { id },
      include: { invoice: true },
    })

    if (!existing) {
      return Response.json({ error: 'Payment not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = paymentSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const { invoiceId, paymentDate, paymentMethod, amount, notes } = parsed.data

    // Verify invoice exists
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, clientId: true, total: true, amountPaid: true, currency: true },
    })

    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const payment = await prisma.payment.update({
      where: { id },
      data: {
        paymentDate: new Date(paymentDate),
        paymentMethod,
        amount,
        currency: invoice.currency,
        notes: notes || '',
        invoiceId,
        clientId: invoice.clientId,
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        client: { select: { id: true, firstName: true, lastName: true, organization: true } },
      },
    })

    // Recalculate invoice totals
    const allPayments = await prisma.payment.aggregate({
      where: { invoiceId },
      _sum: { amount: true },
    })

    const totalPaid = Number(allPayments._sum.amount || 0)
    const totalInvoice = Number(invoice.total)
    const newAmountDue = Math.max(0, totalInvoice - totalPaid)

    const newStatus = newAmountDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'sent'

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        amountPaid: totalPaid,
        amountDue: newAmountDue,
        status: newStatus,
      },
    })

    // If the invoice changed, recalculate the old invoice too
    if (existing.invoiceId !== invoiceId) {
      const oldPayments = await prisma.payment.aggregate({
        where: { invoiceId: existing.invoiceId },
        _sum: { amount: true },
      })

      const oldTotalPaid = Number(oldPayments._sum.amount || 0)
      const oldTotalInvoice = Number(existing.invoice.total)
      const oldAmountDue = Math.max(0, oldTotalInvoice - oldTotalPaid)
      const oldStatus = oldAmountDue <= 0 ? 'paid' : oldTotalPaid > 0 ? 'partial' : 'sent'

      await prisma.invoice.update({
        where: { id: existing.invoiceId },
        data: {
          amountPaid: oldTotalPaid,
          amountDue: oldAmountDue,
          status: oldStatus,
        },
      })
    }

    return Response.json(payment)
  } catch (error) {
    console.error('Update payment error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const existing = await prisma.payment.findUnique({
    where: { id },
    include: { invoice: true },
  })

  if (!existing) {
    return Response.json({ error: 'Payment not found' }, { status: 404 })
  }

  await prisma.payment.delete({ where: { id } })

  // Recalculate invoice amounts
  const remainingPayments = await prisma.payment.aggregate({
    where: { invoiceId: existing.invoiceId },
    _sum: { amount: true },
  })

  const totalPaid = Number(remainingPayments._sum.amount || 0)
  const totalInvoice = Number(existing.invoice.total)
  const newAmountDue = Math.max(0, totalInvoice - totalPaid)
  const newStatus = newAmountDue <= 0 ? 'paid' : totalPaid > 0 ? 'partial' : 'sent'

  await prisma.invoice.update({
    where: { id: existing.invoiceId },
    data: {
      amountPaid: totalPaid,
      amountDue: newAmountDue,
      status: newStatus,
    },
  })

  return Response.json({ message: 'Payment deleted successfully' })
}
