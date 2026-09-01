import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import prisma from '@/lib/prisma'
import { invoiceSchema } from '@/lib/validators'
import { postInvoiceAccrual, unpostInvoiceAccrual } from '@/lib/invoicePosting'
import { assertNotLocked } from '@/lib/periodLock'
import { toAccountingDate } from '@/lib/fx'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Read via Bearer token (headless agents) OR an interactive session, so an
  // agent can fetch the current line items before editing them.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }
  const session = authed.via === 'session' ? await auth() : null

  const { id } = await params

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: true,
      lineItems: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })

  if (!invoice) {
    return Response.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // Drafts are hidden from accountant (read-only) sessions — indistinguishable
  // from a missing invoice.
  if (invoice.status === 'draft' && session?.user?.role === 'accountant') {
    return Response.json({ error: 'Invoice not found' }, { status: 404 })
  }

  return Response.json(invoice)
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Edit (incl. full line-item replacement) via Bearer token OR session. The
  // body is still validated by invoiceSchema and period locks still apply.
  // DELETE below stays session-only: destructive, no headless use case.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const { id } = await params

  try {
    const existing = await prisma.invoice.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = invoiceSchema.safeParse(body)

    if (!parsed.success) {
      return Response.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const {
      clientId,
      currency,
      dateIssued,
      dateDue,
      lineItems,
      description,
      reference,
      notes,
      terms,
      discount,
      onlinePaymentsEnabled,
      allowPartialPayments,
    } = parsed.data

    // Verify client exists
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 })
    }

    // Calculate totals
    const calculatedLineItems = lineItems.map((li, index) => {
      const lineTotal = li.rate * li.quantity
      return {
        title: li.title,
        description: li.description,
        rate: li.rate,
        quantity: li.quantity,
        lineTotal,
        taxCodes: li.taxCodes,
        sortOrder: index,
      }
    })

    const subtotal = calculatedLineItems.reduce((sum, li) => sum + li.lineTotal, 0)
    const discountAmount = discount || 0

    let taxTotal = 0
    for (const li of calculatedLineItems) {
      for (const code of li.taxCodes) {
        const [, rateStr] = code.split(':')
        const rate = parseFloat(rateStr || '0') || (code.toUpperCase().includes('GST') ? 5 : 0)
        taxTotal += li.lineTotal * (rate / 100)
      }
    }

    const total = subtotal - discountAmount + taxTotal

    // Get current amount paid to recalculate amount due
    const currentAmountPaid = Number(existing.amountPaid)
    const amountDue = total - currentAmountPaid

    // ── Accrual GL re-posting (spec §2 Phase 4) ──────────────────────────────
    // If this invoice already has a posted accrual JE and a GL-relevant field
    // changes, the accrual must be reversed and re-posted at the new dateIssued
    // rate. GL-relevant = amount (subtotal/tax/total), currency, dateIssued, or
    // line items (which drive subtotal/tax). Non-GL edits (description, notes,
    // terms, reference, due date, client, payment flags) proceed in place.
    const isAccrued = !!existing.journalEntryId

    let needsRepost = false
    if (isAccrued) {
      const existingLineItems = await prisma.invoiceLineItem.findMany({
        where: { invoiceId: id },
        orderBy: { sortOrder: 'asc' },
      })
      const sameLineItems =
        existingLineItems.length === calculatedLineItems.length &&
        existingLineItems.every((eli, i) => {
          const nli = calculatedLineItems[i]
          return (
            eli.title === nli.title &&
            (eli.description || '') === (nli.description || '') &&
            round2(Number(eli.rate)) === round2(nli.rate) &&
            round2(Number(eli.quantity)) === round2(nli.quantity) &&
            round2(Number(eli.lineTotal)) === round2(nli.lineTotal) &&
            JSON.stringify(eli.taxCodes) === JSON.stringify(nli.taxCodes)
          )
        })

      const glRelevantChanged =
        existing.currency !== currency ||
        toAccountingDate(existing.dateIssued).getTime() !==
          toAccountingDate(new Date(dateIssued)).getTime() ||
        round2(Number(existing.subtotal)) !== round2(subtotal) ||
        round2(Number(existing.taxTotal)) !== round2(taxTotal) ||
        round2(Number(existing.total)) !== round2(total) ||
        round2(Number(existing.discount)) !== round2(discountAmount) ||
        !sameLineItems

      needsRepost = glRelevantChanged
    }

    if (needsRepost) {
      // Reject up-front if either the OLD accrual entryDate or the NEW
      // dateIssued falls in a locked period — never produce a one-sided revert.
      try {
        await assertNotLocked(toAccountingDate(existing.dateIssued))
        await assertNotLocked(toAccountingDate(new Date(dateIssued)))
      } catch (e) {
        const err = e as Error & { code?: string }
        if (err.code === 'PERIOD_LOCKED') {
          return Response.json({ error: err.message }, { status: 409 })
        }
        throw e
      }

      // Reverse the existing accrual (clears journalEntryId + cad* fields).
      await unpostInvoiceAccrual(id, `Invoice ${existing.invoiceNumber} edited — re-posting accrual`)
    }

    // Delete existing line items and recreate
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: id } })

    const invoice = await prisma.invoice.update({
      where: { id },
      data: {
        clientId,
        currency,
        dateIssued: new Date(dateIssued),
        dateDue: new Date(dateDue),
        subtotal,
        taxTotal,
        total,
        amountDue: Math.max(0, amountDue),
        description: description || '',
        reference: reference || '',
        notes: notes || '',
        terms: terms || '',
        discount: discountAmount,
        ...(typeof onlinePaymentsEnabled === 'boolean'
          ? { onlinePaymentsEnabled }
          : {}),
        ...(typeof allowPartialPayments === 'boolean'
          ? { allowPartialPayments }
          : {}),
        lineItems: {
          create: calculatedLineItems,
        },
      },
      include: {
        client: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paymentDate: 'desc' } },
      },
    })

    // Re-post the accrual at the (possibly new) dateIssued rate. Locks were
    // already validated above, so this is safe; postInvoiceAccrual re-reads the
    // freshly-updated invoice row and writes the new JE + cad* fields.
    if (needsRepost) {
      try {
        await postInvoiceAccrual(id)
      } catch (e) {
        const err = e as Error & { code?: string }
        if (err.code === 'PERIOD_LOCKED') {
          return Response.json({ error: err.message }, { status: 409 })
        }
        throw e
      }
      const reposted = await prisma.invoice.findUnique({
        where: { id },
        include: {
          client: true,
          lineItems: { orderBy: { sortOrder: 'asc' } },
          payments: { orderBy: { paymentDate: 'desc' } },
        },
      })
      return Response.json(reposted)
    }

    return Response.json(invoice)
  } catch (error) {
    console.error('Update invoice error:', error)
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

  try {
    const existing = await prisma.invoice.findUnique({ where: { id } })
    if (!existing) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Block deletion of an accrued invoice — its GL accrual must be voided/
    // reversed first (we never hard-delete a row with posted ledger impact).
    if (existing.journalEntryId) {
      return Response.json(
        { error: 'Cannot delete an accrued invoice. Void it first to reverse the journal entry.' },
        { status: 409 }
      )
    }

    // Check for payments
    const paymentCount = await prisma.payment.count({ where: { invoiceId: id } })
    if (paymentCount > 0) {
      return Response.json(
        { error: 'Cannot delete invoice with existing payments. Remove payments first.' },
        { status: 409 }
      )
    }

    // Line items and activities are cascade deleted
    await prisma.invoice.delete({ where: { id } })

    return Response.json({ message: 'Invoice deleted successfully' })
  } catch (error) {
    // A foreign-key constraint (e.g. a related row not covered by the guards
    // above) should surface as a clean 409, never an unhandled 500.
    const code = (error as { code?: string }).code
    if (code === 'P2003' || code === 'P2014') {
      return Response.json(
        { error: 'Cannot delete this invoice because other records reference it. Remove those first.' },
        { status: 409 }
      )
    }
    if (code === 'P2025') {
      // Row vanished between the lookup and the delete — treat as already gone.
      return Response.json({ message: 'Invoice deleted successfully' })
    }
    console.error('Delete invoice error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
