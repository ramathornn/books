import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { assertNotReconLocked } from '@/lib/reconLock'
import { postInvoiceAccrual } from '@/lib/invoicePosting'
import { getCadRate } from '@/lib/fx'
import { findArAccount } from '@/lib/glAccounts'
import { findRealizedFxAccount } from '@/lib/fxAccounts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface SplitAllocation {
  /** Settle this invoice's A/R (accrue-first). Mutually exclusive with paymentId. */
  invoiceId?: string
  /** OR clear this pre-existing undeposited Payment (deposit → bank). The invoice
   *  is already paid; only cash moves from clearing to the bank. */
  paymentId?: string
  /** Amount applied, in the deposit's (= invoice/payment's) currency. */
  amount: number
}

export interface SplitMatchInput {
  txId: string
  /** One deposit fans out across these invoices. */
  allocations: SplitAllocation[]
  /**
   * GL account for the fee gap = Σ allocations − deposit (e.g. Stripe/processing
   * fees on a net-of-fee deposit). Required when the gap exceeds a cent.
   */
  feeGlAccountId?: string
  /** Reject if the fee gap exceeds this (safety cap, in deposit currency). */
  maxFee?: number
  /** Override the realized-FX (499) account. */
  fxGlAccountId?: string
}

export type SplitMatchResult =
  | {
      ok: true
      journalEntryId: string
      paymentIds: string[]
      depositCad: number
      feeCad: number
      fxNet: number
    }
  | { ok: false; status: number; error: string }

/**
 * Settle ONE money-in deposit against MULTIPLE invoices in a single posted
 * journal entry, allowing a fee gap (Σ allocations − deposit) to be expensed.
 *
 * Covers both agent cases:
 *   - lump receipt   → multiple allocations, no fee
 *   - net-of-fee     → one (or more) allocations whose total exceeds the deposit;
 *                      the shortfall posts to feeGlAccountId
 *
 * Per-invoice settlement mirrors matchTransaction exactly (accrue-first, A/R
 * relief at the CAD accrual basis, native amountPaid/Due/status). All invoices
 * must share the deposit's currency (use /api/banking/match per invoice for
 * cross-currency). Every created Payment is linked to the one settlement JE, so
 * /api/banking/uncategorize reverses the whole split in one call.
 *
 * JE: DR bank (deposit, CAD) + DR fee (gap, CAD) + CR A/R per invoice (relief) +
 * a realized-FX plug (499) that absorbs the settlement-vs-accrual spread.
 */
export async function matchTransactionSplit(
  input: SplitMatchInput
): Promise<SplitMatchResult> {
  const { txId, allocations } = input
  if (!txId) return { ok: false, status: 400, error: 'txId required' }
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return { ok: false, status: 400, error: 'allocations required (non-empty)' }
  }
  for (const a of allocations) {
    if (!(a?.invoiceId || a?.paymentId) || !(Number(a.amount) > 0)) {
      return { ok: false, status: 400, error: 'each allocation needs invoice_id OR payment_id and amount > 0' }
    }
  }
  const usesInvoice = allocations.some((a) => a.invoiceId)
  const usesPayment = allocations.some((a) => a.paymentId)
  if (usesInvoice && usesPayment) {
    return { ok: false, status: 400, error: 'allocations must be all invoice_id or all payment_id, not mixed' }
  }

  const tx = await prisma.bankTransaction.findUnique({
    where: { id: txId },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!tx) return { ok: false, status: 404, error: 'Bank transaction not found' }
  if (tx.status === 'posted') return { ok: false, status: 400, error: 'Already posted' }
  if (Number(tx.amount) <= 0) {
    return { ok: false, status: 400, error: 'Split match applies to money-in deposits only' }
  }
  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
  } catch (e) {
    return { ok: false, status: 423, error: (e as Error).message }
  }

  const bankGl = tx.bankAccount.glAccount
  const bankCurrency = (bankGl.currency || 'CAD').toUpperCase()
  const depositNative = round2(Math.abs(Number(tx.amount)))

  // One rate for the whole deposit; all invoices must be in the deposit currency.
  let rate = 1
  let rateDate = tx.transactionDate
  if (bankCurrency !== 'CAD') {
    try {
      const r = await getCadRate(bankCurrency, tx.transactionDate)
      rate = r.rate
      rateDate = r.rateDate
    } catch (e) {
      return { ok: false, status: 400, error: `No FX rate for settlement: ${(e as Error).message}` }
    }
  }
  const depositCad = round2(depositNative * rate)

  // ── Payment-clearing split: the deposit clears one or more PRE-EXISTING
  // undeposited Payments (their invoices are already paid). Only cash moves from
  // SYS-UNDEPOSITED-FUNDS to the bank — A/R is untouched. Mirrors the single
  // 'payment' match: value the deposit at the cleared CAD basis so a same-currency
  // clear nets exactly; any shortfall is the card/processing fee. ──
  if (usesPayment) {
    const clearing = await prisma.gLAccount.findFirst({
      where: { accountNumber: 'SYS-UNDEPOSITED-FUNDS' },
    })
    if (!clearing) {
      return { ok: false, status: 500, error: 'No SYS-UNDEPOSITED-FUNDS clearing account in chart' }
    }

    type PPlan = { paymentId: string; invoiceId: string | null; invNo: string; cadBasis: number }
    const pplans: PPlan[] = []
    const seenP = new Set<string>()
    let sumPaymentNative = 0
    let sumBasis = 0

    for (const a of allocations) {
      const pid = a.paymentId as string
      if (seenP.has(pid)) return { ok: false, status: 400, error: `Duplicate payment in allocations: ${pid}` }
      seenP.add(pid)

      const payment = await prisma.payment.findUnique({
        where: { id: pid },
        include: { invoice: { select: { invoiceNumber: true } } },
      })
      if (!payment) return { ok: false, status: 404, error: `Payment not found: ${pid}` }
      if (!payment.journalEntryId || payment.cadAmount == null) {
        return { ok: false, status: 400, error: `Payment ${pid} has not been cleared to undeposited funds; nothing to move to the bank.` }
      }
      const already = await prisma.bankTransaction.findFirst({
        where: { matchedPaymentId: pid, status: 'posted' },
        select: { id: true },
      })
      if (already) return { ok: false, status: 400, error: `Payment ${pid} is already matched to a bank deposit.` }
      if ((payment.currency || 'CAD').toUpperCase() !== bankCurrency) {
        return { ok: false, status: 400, error: `Payment ${pid} is ${payment.currency} but the deposit is ${bankCurrency}; currencies must match.` }
      }
      const paymentNative = round2(Number(payment.amount))
      const allocNative = round2(Number(a.amount))
      if (Math.abs(allocNative - paymentNative) > 0.01) {
        return { ok: false, status: 400, error: `Allocation ${allocNative} must equal payment ${pid}'s full amount ${paymentNative}; partial clears use /api/banking/match.` }
      }
      pplans.push({
        paymentId: pid,
        invoiceId: payment.invoiceId,
        invNo: payment.invoice?.invoiceNumber ?? '',
        cadBasis: round2(Number(payment.cadAmount)),
      })
      sumPaymentNative = round2(sumPaymentNative + paymentNative)
      sumBasis = round2(sumBasis + Number(payment.cadAmount))
    }

    const feeNative = round2(sumPaymentNative - depositNative)
    if (feeNative < -0.01) {
      return { ok: false, status: 400, error: `Deposit (${depositNative}) exceeds the cleared payments (${sumPaymentNative}); overpayment is not supported.` }
    }
    const blendedRate = sumPaymentNative > 0 ? sumBasis / sumPaymentNative : 1
    const depositCadAtBasis = round2(depositNative * blendedRate)
    const feeCad = round2(sumBasis - depositCadAtBasis)
    if (feeCad > 0.005 && !input.feeGlAccountId) {
      return { ok: false, status: 400, error: `Fee gap of ${feeNative} ${bankCurrency} between the cleared payments and the deposit; pass fee_gl_account_id (or fee_account_number) to expense it.` }
    }
    if (typeof input.maxFee === 'number' && feeNative > input.maxFee + 0.005) {
      return { ok: false, status: 400, error: `Fee gap ${feeNative} exceeds max_fee ${input.maxFee}.` }
    }

    const plines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = [
      {
        glAccountId: bankGl.id,
        description: `Deposit clears ${pplans.length} payment${pplans.length > 1 ? 's' : ''}`,
        debit: depositCadAtBasis,
        credit: 0,
      },
    ]
    if (feeCad > 0.005) {
      plines.push({ glAccountId: input.feeGlAccountId as string, description: 'Processing/bank fee on deposit', debit: feeCad, credit: 0 })
    }
    for (const p of pplans) {
      plines.push({ glAccountId: clearing.id, description: `Clear undeposited · ${p.invNo}`.trim(), debit: 0, credit: p.cadBasis })
    }
    const pDr = round2(depositCadAtBasis + (feeCad > 0.005 ? feeCad : 0))
    const pFx = round2(pDr - sumBasis)
    if (Math.abs(pFx) > 0.005) {
      let fx
      try {
        fx = await findRealizedFxAccount(input.fxGlAccountId)
      } catch (e) {
        return { ok: false, status: 400, error: (e as Error).message }
      }
      if (pFx > 0) plines.push({ glAccountId: fx.id, description: 'Realized FX gain on deposit', debit: 0, credit: pFx })
      else plines.push({ glAccountId: fx.id, description: 'Realized FX loss on deposit', debit: -pFx, credit: 0 })
    }

    let pje
    try {
      pje = await createJournalEntry({
        entryDate: tx.transactionDate,
        description: `Split deposit clears undeposited funds (${pplans.length} payment${pplans.length > 1 ? 's' : ''})`,
        memo: `Bank tx: ${tx.description.slice(0, 100)}`,
        status: 'posted',
        lines: plines,
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'PERIOD_LOCKED') return { ok: false, status: 423, error: (e as Error).message }
      return { ok: false, status: 500, error: `Failed to post settlement JE: ${(e as Error).message}` }
    }

    // Link the deposit to the FIRST cleared payment. uncategorize voids this JE
    // (cash back to clearing) and — because these payments pre-existed (their
    // journalEntryId differs from this JE) — does NOT delete them.
    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        status: 'posted',
        journalEntryId: pje.id,
        matchedPaymentId: pplans[0].paymentId,
        matchedInvoiceId: pplans[0].invoiceId,
      },
    })

    return { ok: true, journalEntryId: pje.id, paymentIds: pplans.map((p) => p.paymentId), depositCad: depositCadAtBasis, feeCad, fxNet: pFx }
  }

  const ar = await findArAccount()
  if (!ar) return { ok: false, status: 500, error: 'No A/R account in chart' }

  type Plan = {
    invoiceId: string
    clientId: string
    invoiceNumber: string
    alloc: number
    cadApplied: number
    arRelief: number
    newAmountPaid: number
    newAmountDue: number
    newStatus: string
    newReliefToDate: number
  }
  const plans: Plan[] = []
  const seen = new Set<string>()
  let sumAlloc = 0
  let sumArRelief = 0

  for (const a of allocations) {
    const invId = a.invoiceId as string
    if (seen.has(invId)) {
      return { ok: false, status: 400, error: `Duplicate invoice in allocations: ${invId}` }
    }
    seen.add(invId)

    let invoice = await prisma.invoice.findUnique({ where: { id: invId } })
    if (!invoice) return { ok: false, status: 404, error: `Invoice not found: ${invId}` }
    if ((invoice.currency || 'CAD').toUpperCase() !== bankCurrency) {
      return {
        ok: false,
        status: 400,
        error: `Invoice ${invoice.invoiceNumber} is ${invoice.currency} but the deposit is ${bankCurrency}; split match requires same currency. Use /api/banking/match per invoice for cross-currency.`,
      }
    }
    // Accrue first so A/R carries the CAD accrual basis, then re-read.
    if (!invoice.journalEntryId) {
      try {
        await postInvoiceAccrual(invoice.id)
      } catch (e) {
        return { ok: false, status: 400, error: `Could not accrue ${invoice.invoiceNumber}: ${(e as Error).message}` }
      }
      const reloaded = await prisma.invoice.findUnique({ where: { id: invId } })
      if (!reloaded) return { ok: false, status: 404, error: `Invoice not found: ${invId}` }
      invoice = reloaded
    }

    const alloc = round2(Number(a.amount))
    const invoiceTotalNative = Number(invoice.total)
    const newAmountPaid = round2(Number(invoice.amountPaid) + alloc)
    const newAmountDue = round2(invoiceTotalNative - newAmountPaid)
    if (newAmountDue < -0.01) {
      const due = round2(invoiceTotalNative - Number(invoice.amountPaid))
      return { ok: false, status: 400, error: `Allocation ${alloc} overpays invoice ${invoice.invoiceNumber} (amount due ${due})` }
    }
    const isFinal = newAmountDue <= 0.005
    const newStatus = isFinal ? 'paid' : newAmountPaid > 0 ? 'partial' : invoice.status

    const cadTotal = Number(invoice.cadTotal ?? 0)
    const cadReliefToDate = Number(invoice.cadReliefToDate)
    const arRelief = isFinal
      ? round2(cadTotal - cadReliefToDate)
      : round2(cadTotal * (alloc / invoiceTotalNative))
    const cadApplied = round2(alloc * rate)

    plans.push({
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      invoiceNumber: invoice.invoiceNumber,
      alloc,
      cadApplied,
      arRelief,
      newAmountPaid,
      newAmountDue,
      newStatus,
      newReliefToDate: round2(cadReliefToDate + arRelief),
    })
    sumAlloc = round2(sumAlloc + alloc)
    sumArRelief = round2(sumArRelief + arRelief)
  }

  // Fee gap = what was applied to invoices minus what actually landed in the bank.
  const feeNative = round2(sumAlloc - depositNative)
  if (feeNative < -0.01) {
    return {
      ok: false,
      status: 400,
      error: `Deposit (${depositNative}) exceeds allocations (${sumAlloc}). Allocations must total at least the deposit; any shortfall is treated as a fee. Overpayment is not supported here.`,
    }
  }
  const feeCad = round2(Math.max(0, feeNative) * rate)
  if (feeCad > 0.005 && !input.feeGlAccountId) {
    return {
      ok: false,
      status: 400,
      error: `Fee gap of ${feeNative} ${bankCurrency} between allocations and the deposit; pass fee_gl_account_id (or fee_account_number) to expense it.`,
    }
  }
  if (typeof input.maxFee === 'number' && feeNative > input.maxFee + 0.005) {
    return { ok: false, status: 400, error: `Fee gap ${feeNative} exceeds max_fee ${input.maxFee}.` }
  }

  const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = [
    {
      glAccountId: bankGl.id,
      description: `Deposit (${plans.length} invoice${plans.length > 1 ? 's' : ''})`,
      debit: depositCad,
      credit: 0,
    },
  ]
  if (feeCad > 0.005) {
    lines.push({ glAccountId: input.feeGlAccountId as string, description: 'Processing/bank fee on deposit', debit: feeCad, credit: 0 })
  }
  for (const p of plans) {
    lines.push({ glAccountId: ar.id, description: `Payment ${p.invoiceNumber}`, debit: 0, credit: p.arRelief })
  }

  // Realized-FX plug (499): balances the entry and absorbs the settlement-vs-
  // accrual spread + whole-cent rounding. Zero for same-rate CAD deposits.
  const drSoFar = round2(depositCad + (feeCad > 0.005 ? feeCad : 0))
  const fxNet = round2(drSoFar - sumArRelief)
  if (Math.abs(fxNet) > 0.005) {
    let fx
    try {
      fx = await findRealizedFxAccount(input.fxGlAccountId)
    } catch (e) {
      return { ok: false, status: 400, error: (e as Error).message }
    }
    if (fxNet > 0) {
      lines.push({ glAccountId: fx.id, description: 'Realized FX gain on deposit', debit: 0, credit: fxNet })
    } else {
      lines.push({ glAccountId: fx.id, description: 'Realized FX loss on deposit', debit: -fxNet, credit: 0 })
    }
  }

  let je
  try {
    je = await createJournalEntry({
      entryDate: tx.transactionDate,
      description: `Split deposit settlement (${plans.length} invoice${plans.length > 1 ? 's' : ''})`,
      memo: `Bank tx: ${tx.description.slice(0, 100)}`,
      status: 'posted',
      lines,
    })
  } catch (e) {
    if ((e as { code?: string }).code === 'PERIOD_LOCKED') {
      return { ok: false, status: 423, error: (e as Error).message }
    }
    return { ok: false, status: 500, error: `Failed to post settlement JE: ${(e as Error).message}` }
  }

  const paymentIds: string[] = []
  for (const p of plans) {
    const payment = await prisma.payment.create({
      data: {
        invoiceId: p.invoiceId,
        clientId: p.clientId,
        amount: p.alloc,
        currency: bankCurrency,
        paymentDate: tx.transactionDate,
        paymentMethod: 'Bank Transfer',
        notes: `Split-matched from bank tx: ${tx.description.slice(0, 100)}`,
        cadAmount: new Prisma.Decimal(p.cadApplied),
        cadArRelief: new Prisma.Decimal(p.arRelief),
        fxRate: new Prisma.Decimal(rate),
        fxRateDate: rateDate,
        journalEntryId: je.id,
      },
    })
    paymentIds.push(payment.id)
    await prisma.invoice.update({
      where: { id: p.invoiceId },
      data: {
        amountPaid: p.newAmountPaid,
        amountDue: p.newAmountDue,
        status: p.newStatus,
        cadReliefToDate: new Prisma.Decimal(p.newReliefToDate),
      },
    })
  }

  await prisma.bankTransaction.update({
    where: { id: tx.id },
    data: {
      status: 'posted',
      journalEntryId: je.id,
      matchedInvoiceId: plans[0].invoiceId,
      matchedPaymentId: paymentIds[0],
    },
  })

  return { ok: true, journalEntryId: je.id, paymentIds, depositCad, feeCad, fxNet }
}
