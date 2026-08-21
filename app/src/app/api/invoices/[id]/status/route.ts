import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { postInvoiceAccrual, unpostInvoiceAccrual } from '@/lib/invoicePosting'

const ACCRUABLE_STATUSES = new Set(['sent', 'viewed', 'partial', 'paid'])

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Flip status via Bearer token (headless agents) OR an interactive session.
  // draft -> sent auto-accrues (DR A/R / CR Sales), so a bank match can settle.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const { id } = await params

  try {
    const body = await request.json()
    const { status } = body

    if (!status || !['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'archived', 'void', 'refunded'].includes(status)) {
      return Response.json({ error: 'Invalid status' }, { status: 400 })
    }

    const existing = await prisma.invoice.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (status === 'refunded' && Number(existing.amountPaid) <= 0) {
      return Response.json(
        { error: 'Invoice has no recorded payments to refund' },
        { status: 400 }
      )
    }

    const previousStatus = existing.status

    const invoice = await prisma.invoice.update({
      where: { id },
      data: { status },
    })

    // GL posting: accrual auto-posts the first time an invoice leaves `draft`
    // into an accruable status and has not yet been accrued. PERIOD_LOCKED is
    // tolerated — we skip posting but still flip the status.
    if (
      status !== 'void' &&
      previousStatus === 'draft' &&
      ACCRUABLE_STATUSES.has(status) &&
      existing.journalEntryId == null
    ) {
      try {
        await postInvoiceAccrual(id)
      } catch (postError) {
        if ((postError as { code?: string })?.code === 'PERIOD_LOCKED') {
          console.warn(`Skipping accrual for invoice ${id}: period locked`)
        } else {
          throw postError
        }
      }
    }

    // Void: reverse the accrual journal entry (if any) and stamp void metadata.
    if (status === 'void') {
      await unpostInvoiceAccrual(id, `Invoice ${existing.invoiceNumber} voided`)
    }

    // Refunded: flag the invoice's payments as refunded. The revenue accrual
    // stays posted — the money-out entry books via the banking flow when the
    // refund clears the bank, same as any other cash movement.
    if (status === 'refunded') {
      await prisma.payment.updateMany({
        where: { invoiceId: id },
        data: { status: 'refunded' },
      })
    }

    // Log activity
    await prisma.invoiceActivity.create({
      data: {
        invoiceId: id,
        type: status === 'sent' ? 'sent' : 'status_changed',
        description: status === 'sent'
          ? 'Invoice marked as sent'
          : status === 'archived'
          ? 'Invoice archived'
          : status === 'void'
          ? 'Invoice voided'
          : status === 'refunded'
          ? 'Invoice marked as refunded'
          : `Invoice status changed to ${status}`,
      },
    })

    return Response.json(invoice)
  } catch (error) {
    console.error('Update invoice status error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
