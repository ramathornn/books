import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { findArAccount, findBadDebtAccount } from '@/lib/glAccounts'
import { toAccountingDate } from '@/lib/fx'
import { audit } from '@/lib/audit'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// An invoice is only write-off-able if it has been accrued to A/R (journalEntryId
// set) and is not already paid/voided/written-off.
const NON_WRITEOFFABLE = new Set(['draft', 'paid', 'void', 'archived', 'bad_debt'])

/**
 * Bad-debt write-off for an accrued, unpaid invoice.
 *
 * Posts DR Bad Debt Expense / CR A/R for the remaining CAD A/R balance
 * (cadTotal − cadReliefToDate), marks the invoice status='bad_debt' and records
 * writtenOffAt + writeOffJournalEntryId. The invoice then drops out of A/R aging
 * (which excludes paid/draft/bad_debt).
 */
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
    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) {
      return Response.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if (!invoice.journalEntryId) {
      return Response.json(
        { error: 'Invoice has not been accrued to A/R, so there is nothing to write off.' },
        { status: 400 }
      )
    }
    if (NON_WRITEOFFABLE.has(invoice.status)) {
      return Response.json(
        { error: `Invoice with status '${invoice.status}' cannot be written off as bad debt.` },
        { status: 400 }
      )
    }

    // Remaining CAD A/R balance still owed on this invoice.
    const cadTotal = Number(invoice.cadTotal ?? 0)
    const cadReliefToDate = Number(invoice.cadReliefToDate ?? 0)
    const remaining = round2(cadTotal - cadReliefToDate)
    if (remaining <= 0) {
      return Response.json(
        { error: 'No remaining A/R balance to write off on this invoice.' },
        { status: 400 }
      )
    }

    const ar = await findArAccount()
    if (!ar) {
      return Response.json({ error: 'No A/R account found in the chart of accounts.' }, { status: 400 })
    }
    const badDebt = await findBadDebtAccount()
    if (!badDebt) {
      return Response.json(
        {
          error:
            'No "Bad Debt" expense account found in the chart of accounts. Add an expense account named "Bad Debt" before writing off this invoice.',
        },
        { status: 400 }
      )
    }

    // Write off as of today (the date the debt is deemed uncollectible).
    const entryDate = toAccountingDate(new Date())

    let je
    try {
      const result = await prisma.$transaction(async (tx) => {
        const created = await createJournalEntry({
          entryDate,
          description: `Bad debt write-off ${invoice.invoiceNumber}`,
          memo: `Wrote off ${remaining.toFixed(2)} CAD A/R for invoice ${invoice.invoiceNumber} as uncollectible`,
          status: 'posted',
          kind: 'standard',
          lines: [
            {
              glAccountId: badDebt.id,
              description: `Bad debt · ${invoice.invoiceNumber}`,
              debit: remaining,
              credit: 0,
            },
            {
              glAccountId: ar.id,
              description: `A/R write-off · ${invoice.invoiceNumber}`,
              debit: 0,
              credit: remaining,
            },
          ],
          client: tx,
        })

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: 'bad_debt',
            writtenOffAt: new Date(),
            writeOffJournalEntryId: created.id,
            cadReliefToDate: new Prisma.Decimal(round2(cadReliefToDate + remaining)),
          },
        })

        await tx.invoiceActivity.create({
          data: {
            invoiceId: invoice.id,
            type: 'status_changed',
            description: `Invoice written off as bad debt (${remaining.toFixed(2)} CAD)`,
          },
        })

        return created
      })
      je = result
    } catch (e) {
      if ((e as { code?: string })?.code === 'PERIOD_LOCKED') {
        return Response.json(
          { error: 'The accounting period for this date is locked. Unlock it before writing off this invoice.' },
          { status: 409 }
        )
      }
      throw e
    }

    await audit({
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'update',
      summary: `Invoice ${invoice.invoiceNumber} written off as bad debt · ${remaining.toFixed(2)} CAD`,
      metadata: { writeOffJournalEntryId: je.id, remainingCad: remaining },
    })

    return Response.json({ ok: true, journalEntryId: je.id, amount: remaining })
  } catch (error) {
    console.error('Write off invoice error:', error)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}
