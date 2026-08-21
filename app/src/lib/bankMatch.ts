import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { assertNotReconLocked } from '@/lib/reconLock'
import { postInvoiceAccrual } from '@/lib/invoicePosting'
import { getCadRate } from '@/lib/fx'
import { findArAccount } from '@/lib/glAccounts'
import { findRealizedFxAccount } from '@/lib/fxAccounts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Resolve the undeposited-funds clearing account by its well-known accountNumber.
 * Standalone Payments (cash received with no bank transaction) settled A/R into
 * this clearing account; a later bank-match moves it from clearing to the bank.
 */
async function findClearingAccount() {
  return prisma.gLAccount.findFirst({ where: { accountNumber: 'SYS-UNDEPOSITED-FUNDS' } })
}

/**
 * Resolve the Accounts Payable control account (mirrors src/app/api/bills/[id]/pay).
 * Lowest account number wins.
 */
async function findApAccount() {
  return prisma.gLAccount.findFirst({
    where: { OR: [{ accountSubclass: 'Accounts Payable' }, { detailType: 'Accounts Payable' }] },
    orderBy: { accountNumber: 'asc' },
  })
}

export type MatchTarget = 'invoice' | 'expense' | 'payment' | 'bill'

export interface MatchInput {
  txId: string
  target: MatchTarget
  targetId: string
  /** Optional override for the realized-FX GL account (invoice/payment paths). */
  fxGlAccountId?: string
}

export type MatchResult =
  | { ok: true; status?: number; journalEntryId: string; paymentId?: string }
  | { ok: false; status: number; error: string }

/**
 * Match a bank transaction to an existing Invoice (creating a Payment), an
 * Expense, a recorded Payment already cleared to undeposited funds, or a Bill
 * (A/P). Shared by the UI match route and any other caller so the posting logic
 * stays identical.
 *
 * Returns a structured result instead of a Response so callers can shape the
 * HTTP response (or aggregate outcomes) themselves. The existing invoice /
 * expense / payment paths are preserved exactly as they were in the route.
 */
export async function matchTransaction(input: MatchInput): Promise<MatchResult> {
  const { txId, fxGlAccountId } = input
  const target = input.target
  const targetId = String(input.targetId || '')
  if (!target || !targetId) return { ok: false, status: 400, error: 'target and targetId required' }

  const tx = await prisma.bankTransaction.findUnique({
    where: { id: txId },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!tx) return { ok: false, status: 404, error: 'Bank transaction not found' }
  if (tx.status === 'posted') return { ok: false, status: 400, error: 'Already posted' }

  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
  } catch (e) {
    return { ok: false, status: 423, error: (e as Error).message }
  }

  const bankAccount = tx.bankAccount.glAccount
  const absAmount = Math.abs(Number(tx.amount))
  const isOut = Number(tx.amount) < 0

  if (target === 'invoice') {
    if (isOut) return { ok: false, status: 400, error: 'Money-out cannot match an invoice' }

    let invoice = await prisma.invoice.findUnique({ where: { id: targetId } })
    if (!invoice) return { ok: false, status: 404, error: 'Invoice not found' }

    // BLOCKER FIX (spec §2 Phase 4): never settle against a foreign face value.
    // If the invoice has not been accrued yet, accrue it FIRST so A/R carries the
    // CAD accrual basis, then re-read the invoice to pick up cadTotal/cadReliefToDate.
    if (!invoice.journalEntryId) {
      try {
        await postInvoiceAccrual(invoice.id)
      } catch (e) {
        return {
          ok: false,
          status: 400,
          error: `Could not accrue invoice before settlement: ${(e as Error).message}`,
        }
      }
      const reloaded = await prisma.invoice.findUnique({ where: { id: targetId } })
      if (!reloaded) return { ok: false, status: 404, error: 'Invoice not found' }
      invoice = reloaded
    }

    // AR account (default 1160A or first A/R-class)
    const ar = await findArAccount()
    if (!ar) return { ok: false, status: 500, error: 'No A/R account in chart' }

    // CAD bank receipt at the settlement-date BoC rate.
    let cadRate
    try {
      cadRate = await getCadRate(invoice.currency, tx.transactionDate)
    } catch (e) {
      return { ok: false, status: 400, error: `No FX rate for settlement: ${(e as Error).message}` }
    }
    const cadReceived = round2(absAmount * cadRate.rate)

    // Native-currency settlement math (amountPaid/amountDue/status track face value).
    const invoiceTotalNative = Number(invoice.total)
    const newAmountPaid = round2(Number(invoice.amountPaid) + absAmount)
    const newAmountDue = round2(invoiceTotalNative - newAmountPaid)
    const isFinalPayment = newAmountDue <= 0.005
    const newStatus = isFinalPayment ? 'paid' : newAmountPaid > 0 ? 'partial' : invoice.status

    // A/R relief at the CAD accrual basis. On the final payment, relieve the
    // exact remaining CAD balance so A/R lands at zero (absorbs prior rounding).
    const cadTotal = Number(invoice.cadTotal ?? 0)
    const cadReliefToDate = Number(invoice.cadReliefToDate)
    const arRelief = isFinalPayment
      ? round2(cadTotal - cadReliefToDate)
      : round2(cadTotal * (absAmount / invoiceTotalNative))

    // Realized FX → 499 (income/credit-normal): gain CREDIT, loss DEBIT.
    const realizedFx = round2(cadReceived - arRelief)

    const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = [
      { glAccountId: bankAccount.id, description: `Payment ${invoice.invoiceNumber}`, debit: cadReceived, credit: 0 },
      { glAccountId: ar.id, description: `Payment ${invoice.invoiceNumber}`, debit: 0, credit: arRelief },
    ]
    if (Math.abs(realizedFx) > 0.005) {
      const fx = await findRealizedFxAccount(fxGlAccountId ? String(fxGlAccountId) : undefined)
      if (realizedFx > 0) {
        lines.push({ glAccountId: fx.id, description: `Realized FX gain · ${invoice.invoiceNumber}`, debit: 0, credit: realizedFx })
      } else {
        lines.push({ glAccountId: fx.id, description: `Realized FX loss · ${invoice.invoiceNumber}`, debit: -realizedFx, credit: 0 })
      }
    }

    const je = await createJournalEntry({
      entryDate: tx.transactionDate,
      description: `Payment for invoice ${invoice.invoiceNumber}`,
      memo: `Bank tx: ${tx.description.slice(0, 100)}`,
      status: 'posted',
      lines,
    })

    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        amount: absAmount,
        currency: invoice.currency,
        paymentDate: tx.transactionDate,
        paymentMethod: 'Bank Transfer',
        notes: `Matched from bank tx: ${tx.description.slice(0, 100)}`,
        cadAmount: new Prisma.Decimal(cadReceived),
        cadArRelief: new Prisma.Decimal(arRelief),
        fxRate: new Prisma.Decimal(cadRate.rate),
        fxRateDate: cadRate.rateDate,
        journalEntryId: je.id,
      },
    })

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        amountPaid: newAmountPaid,
        amountDue: newAmountDue,
        status: newStatus,
        cadReliefToDate: new Prisma.Decimal(round2(cadReliefToDate + arRelief)),
      },
    })

    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'posted',
        matchedInvoiceId: invoice.id,
        matchedPaymentId: payment.id,
        journalEntryId: je.id,
      },
    })
    return { ok: true, paymentId: payment.id, journalEntryId: je.id }
  }

  if (target === 'expense') {
    if (!isOut) return { ok: false, status: 400, error: 'Money-in cannot match an expense' }

    const expense = await prisma.expense.findUnique({ where: { id: targetId }, include: { category: true } })
    if (!expense) return { ok: false, status: 404, error: 'Expense not found' }

    // Find GL account for the expense category
    const categoryGl = expense.category.glAccountId
      ? await prisma.gLAccount.findUnique({ where: { id: expense.category.glAccountId } })
      : null
    if (!categoryGl) {
      return {
        ok: false,
        status: 400,
        error:
          "The matched expense's category isn't linked to a GL account. Edit the category to add a GL link, or categorize directly.",
      }
    }

    const taxAmount = Number(expense.taxAmount || 0)
    const netAmount = Number(expense.amount)

    // JE: DR expense net, DR ITC receivable (if any), CR bank total.
    // Route the recoverable tax (ITC) to the tax code's configured
    // receivableAccountId — NOT the GST/HST Payable account (2315).
    const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number; taxCodeId?: string | null }> = [
      { glAccountId: categoryGl.id, description: expense.description, debit: netAmount, credit: 0 },
    ]
    if (taxAmount > 0) {
      const taxCode = expense.taxCodeId
        ? await prisma.taxCode.findUnique({ where: { id: expense.taxCodeId } })
        : null
      if (taxCode?.receivableAccountId) {
        lines.push({
          glAccountId: taxCode.receivableAccountId,
          description: `${taxCode.name} on ${expense.description.slice(0, 60)}`,
          debit: taxAmount,
          credit: 0,
          taxCodeId: taxCode.id,
        })
      }
    }
    lines.push({ glAccountId: bankAccount.id, description: expense.description, debit: 0, credit: absAmount })

    // Round-fix
    const td = lines.reduce((s, l) => s + l.debit, 0)
    const tc = lines.reduce((s, l) => s + l.credit, 0)
    const diff = Math.round((td - tc) * 100) / 100
    if (diff !== 0) {
      const bankLine = lines.find((l) => l.glAccountId === bankAccount.id)
      if (bankLine) bankLine.credit = Math.round((bankLine.credit + diff) * 100) / 100
    }

    const je = await createJournalEntry({
      entryDate: tx.transactionDate,
      description: `Expense paid: ${expense.description.slice(0, 80)}`,
      memo: `Bank tx: ${tx.description.slice(0, 100)}`,
      status: 'posted',
      lines,
    })

    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'posted',
        matchedExpenseId: expense.id,
        journalEntryId: je.id,
      },
    })
    return { ok: true, journalEntryId: je.id }
  }

  if (target === 'payment') {
    // Clear undeposited funds: a real bank deposit arrives for cash that was
    // already recorded as a Payment and settled to SYS-UNDEPOSITED-FUNDS.
    // This MOVES the cash from clearing to the bank account — it does NOT touch
    // A/R again, and must NOT generate a fresh settlement-date FX gain/loss.
    if (isOut) return { ok: false, status: 400, error: 'Money-out cannot clear a recorded payment' }

    const payment = await prisma.payment.findUnique({
      where: { id: targetId },
      include: { invoice: { select: { invoiceNumber: true } } },
    })
    if (!payment) return { ok: false, status: 404, error: 'Payment not found' }

    // The payment must have been settled to clearing (carries its CAD basis).
    if (!payment.journalEntryId || payment.cadAmount == null) {
      return {
        ok: false,
        status: 400,
        error: 'This payment has not been cleared to undeposited funds, so there is nothing to move to the bank.',
      }
    }
    // Already moved to a bank account?
    const existing = await prisma.bankTransaction.findFirst({
      where: { matchedPaymentId: payment.id, status: 'posted' },
      select: { id: true },
    })
    if (existing) {
      return { ok: false, status: 400, error: 'This payment has already been matched to a bank deposit.' }
    }

    const clearing = await findClearingAccount()
    if (!clearing) return { ok: false, status: 500, error: 'No SYS-UNDEPOSITED-FUNDS clearing account in chart' }

    const invNo = payment.invoice?.invoiceNumber ?? ''

    // The deposit's NATIVE amount is converted to CAD at the SAME rate stored on
    // the Payment (its clearing basis) — NOT a fresh settlement-date rate. A
    // €1,000 Wise deposit against a €1,000 payment clears the exact CAD basis →
    // net zero, no FX line. Use the payment's stored cadAmount when the native
    // amount matches the payment exactly; otherwise convert at the stored rate.
    const paymentNative = round2(Number(payment.amount))
    const storedRate = payment.fxRate != null ? Number(payment.fxRate) : null
    const cadBasis = Number(payment.cadAmount) // CAD that originally landed in clearing

    // CAD value of THIS bank deposit at the payment's basis rate.
    let cadDeposit: number
    if (Math.abs(absAmount - paymentNative) <= 0.005) {
      // Exact native match → clear the exact CAD basis (absorbs prior rounding).
      cadDeposit = round2(cadBasis)
    } else if (storedRate != null) {
      // Partial/rounding difference → convert the native deposit at the stored rate.
      cadDeposit = round2(absAmount * storedRate)
    } else {
      cadDeposit = round2(cadBasis)
    }

    // We must DR bank for the CAD value of the deposit and CR clearing for the
    // CAD basis sitting there. Clear only the proportion of the basis that this
    // deposit covers (exact match clears it fully). Any remainder between the
    // bank debit and the clearing credit is a small realized FX → 499.
    const clearingCredit =
      Math.abs(absAmount - paymentNative) <= 0.005
        ? round2(cadBasis)
        : round2(cadBasis * (absAmount / paymentNative))

    const realizedFx = round2(cadDeposit - clearingCredit)

    const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = [
      { glAccountId: bankAccount.id, description: `Deposit · payment ${invNo}`.trim(), debit: cadDeposit, credit: 0 },
      { glAccountId: clearing.id, description: `Clear undeposited funds · ${invNo}`.trim(), debit: 0, credit: clearingCredit },
    ]
    if (Math.abs(realizedFx) > 0.005) {
      const fx = await findRealizedFxAccount(fxGlAccountId ? String(fxGlAccountId) : undefined)
      if (realizedFx > 0) {
        lines.push({ glAccountId: fx.id, description: `Realized FX gain · deposit ${invNo}`.trim(), debit: 0, credit: realizedFx })
      } else {
        lines.push({ glAccountId: fx.id, description: `Realized FX loss · deposit ${invNo}`.trim(), debit: -realizedFx, credit: 0 })
      }
    }

    const je = await createJournalEntry({
      entryDate: tx.transactionDate,
      description: `Deposit clears undeposited funds${invNo ? ` (payment ${invNo})` : ''}`,
      memo: `Bank tx: ${tx.description.slice(0, 100)}`,
      status: 'posted',
      lines,
    })

    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'posted',
        matchedPaymentId: payment.id,
        matchedInvoiceId: payment.invoiceId,
        journalEntryId: je.id,
      },
    })
    return { ok: true, paymentId: payment.id, journalEntryId: je.id }
  }

  if (target === 'bill') {
    // Match a bank OUTFLOW to an existing Bill (A/P): the money left the bank to
    // pay down a payable. JE: DR <A/P control> / CR <bank> for the amount this
    // deposit covers. This relieves the payable; it does NOT re-book the expense
    // (the bill accrual already did DR expense / CR A/P when it was posted).
    if (!isOut) return { ok: false, status: 400, error: 'Money-in cannot match a bill' }

    const bill = await prisma.bill.findUnique({ where: { id: targetId } })
    if (!bill) return { ok: false, status: 404, error: 'Bill not found' }
    if (bill.status === 'void') return { ok: false, status: 400, error: 'Bill is void' }
    if (bill.status === 'paid') return { ok: false, status: 400, error: 'Bill is already paid' }

    const ap = await findApAccount()
    if (!ap) return { ok: false, status: 500, error: 'No A/P account in chart' }

    // Settle in the bank/bill currency consistently. The A/P control was credited
    // at the bill's native total when the bill was accrued, so we relieve it in
    // the same native amount that this bank line represents. The bank line is
    // already in the bank account's currency; we expect the bill to share that
    // currency. Reject a currency mismatch rather than post an unbalanced /
    // silently FX-converted entry.
    const billCurrency = (bill.currency || 'CAD').toUpperCase()
    const bankCurrency = (bankAccount.currency || 'CAD').toUpperCase()
    if (billCurrency !== bankCurrency) {
      return {
        ok: false,
        status: 400,
        error: `Currency mismatch: bill is ${billCurrency} but the bank account is ${bankCurrency}. Pay this bill from a ${billCurrency} account.`,
      }
    }

    // Don't relieve more than what's still owed on the bill.
    const billDue = round2(Number(bill.amountDue))
    const applied = round2(Math.min(absAmount, billDue))
    if (applied <= 0.005) {
      return { ok: false, status: 400, error: 'This bill has no outstanding balance to pay.' }
    }

    const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = [
      { glAccountId: ap.id, description: `Payment for ${bill.billNumber}`, debit: applied, credit: 0 },
      { glAccountId: bankAccount.id, description: `Payment for ${bill.billNumber}`, debit: 0, credit: applied },
    ]

    const je = await createJournalEntry({
      entryDate: tx.transactionDate,
      description: `Bill payment: ${bill.billNumber}`,
      memo: `Bank tx: ${tx.description.slice(0, 100)}`,
      status: 'posted',
      lines,
    })

    const billPayment = await prisma.billPayment.create({
      data: {
        billId: bill.id,
        paymentDate: tx.transactionDate,
        amount: applied,
        bankAccountId: bankAccount.id,
        bankTransactionId: tx.id,
        journalEntryId: je.id,
        paymentMethod: 'Bank Transfer',
        reference: tx.description.slice(0, 100),
      },
    })

    // Update bill aggregates (mirrors src/app/api/bills/[id]/pay).
    const newPaid = round2(Number(bill.amountPaid) + applied)
    const newDue = round2(Number(bill.total) - newPaid)
    const newStatus = newDue <= 0.005 ? 'paid' : newPaid > 0 ? 'partial' : bill.status
    await prisma.bill.update({
      where: { id: bill.id },
      data: { amountPaid: newPaid, amountDue: Math.max(newDue, 0), status: newStatus },
    })

    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'posted',
        journalEntryId: je.id,
      },
    })
    return { ok: true, paymentId: billPayment.id, journalEntryId: je.id }
  }

  return { ok: false, status: 400, error: 'Unsupported target' }
}
