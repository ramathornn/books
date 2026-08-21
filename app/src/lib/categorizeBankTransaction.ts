import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { audit } from '@/lib/audit'
import { assertNotReconLocked } from '@/lib/reconLock'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export interface CategorizeInput {
  categoryGlAccountId: string
  /** Tri-state: present (even '') means caller chose explicitly, incl. "no tax". */
  taxCodeId?: string | null
  hasTaxCodeKey?: boolean
  vendorId?: string | null
  memo?: string
  payee?: string
}

export type CategorizeResult =
  | { ok: true; journalEntryId: string }
  | { ok: false; status: number; error: string }

/**
 * Post a single pending bank transaction to a GL category, creating its own
 * balanced journal entry. Shared by the single-tx categorize route and the
 * bulk-categorize route so the posting logic stays identical.
 *
 * Returns a structured result instead of a Response so callers can aggregate
 * per-transaction outcomes. Period-lock errors (raised by createJournalEntry)
 * are caught and returned as { ok: false }.
 */
export async function categorizeBankTransaction(
  txId: string,
  input: CategorizeInput
): Promise<CategorizeResult> {
  const categoryGlAccountId = String(input.categoryGlAccountId || '')
  if (!categoryGlAccountId) return { ok: false, status: 400, error: 'categoryGlAccountId required' }

  const tx = await prisma.bankTransaction.findUnique({
    where: { id: txId },
    include: { bankAccount: { include: { glAccount: true } } },
  })
  if (!tx) return { ok: false, status: 404, error: 'Bank transaction not found' }
  if (tx.status === 'posted') return { ok: false, status: 400, error: 'Already posted' }
  if (tx.status === 'excluded') return { ok: false, status: 400, error: 'Excluded — restore first' }

  // Month-end reconciliation lock: refuse to categorize a tx in a locked month.
  try {
    await assertNotReconLocked(tx.bankAccountId, tx.transactionDate)
  } catch (e) {
    return { ok: false, status: 423, error: (e as Error).message }
  }

  const categoryAccount = await prisma.gLAccount.findUnique({ where: { id: categoryGlAccountId } })
  if (!categoryAccount) return { ok: false, status: 400, error: 'Category GL account not found' }

  const bankAccount = tx.bankAccount.glAccount
  const totalAmount = Number(tx.amount) // negative = money out
  const isOut = totalAmount < 0
  const absAmount = Math.abs(totalAmount)

  // Tax handling — tri-state: explicit taxCodeId > GL account default > none.
  let taxCodeId: string | null
  if (input.hasTaxCodeKey) {
    taxCodeId = input.taxCodeId || null
  } else {
    taxCodeId = categoryAccount.defaultTaxCodeId || null
  }
  let taxCode: Awaited<ReturnType<typeof prisma.taxCode.findUnique>> = null
  if (taxCodeId) {
    taxCode = await prisma.taxCode.findUnique({ where: { id: taxCodeId } })
  }

  // Foreign sales are zero-rated: force no GST on a sale/inflow when the bank
  // account is non-CAD. (Posting-layer enforcement, mirrors invoice accrual.)
  const bankIsCad = (bankAccount.currency || 'CAD').toUpperCase() === 'CAD'
  const zeroRate = !isOut && !bankIsCad

  let netAmount = absAmount
  let taxAmount = 0
  if (
    !zeroRate &&
    taxCode &&
    Number(taxCode.rate) > 0 &&
    (taxCode.appliesTo === 'sale' || taxCode.appliesTo === 'purchase')
  ) {
    netAmount = absAmount / (1 + Number(taxCode.rate))
    taxAmount = absAmount - netAmount
  }

  // Direction-correct tax account must exist before we post; never mis-post.
  if (taxAmount > 0) {
    const taxLineAccountId = isOut ? taxCode?.receivableAccountId : taxCode?.payableAccountId
    if (!taxLineAccountId) {
      return {
        ok: false,
        status: 400,
        error: isOut
          ? `Tax code "${taxCode?.name ?? taxCodeId}" has no receivable (ITC) account configured`
          : `Tax code "${taxCode?.name ?? taxCodeId}" has no payable account configured`,
      }
    }
  }

  const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number; taxCodeId?: string | null }> = []

  if (isOut) {
    lines.push({
      glAccountId: categoryAccount.id,
      description: tx.description,
      debit: round2(netAmount),
      credit: 0,
      taxCodeId: taxCodeId || null,
    })
    if (taxAmount > 0 && taxCode?.receivableAccountId) {
      lines.push({
        glAccountId: taxCode.receivableAccountId,
        description: `${taxCode.name} on ${tx.description.slice(0, 60)}`,
        debit: round2(taxAmount),
        credit: 0,
      })
    }
    lines.push({
      glAccountId: bankAccount.id,
      description: tx.description,
      debit: 0,
      credit: round2(absAmount),
    })
  } else {
    lines.push({
      glAccountId: bankAccount.id,
      description: tx.description,
      debit: round2(absAmount),
      credit: 0,
    })
    lines.push({
      glAccountId: categoryAccount.id,
      description: tx.description,
      debit: 0,
      credit: round2(netAmount),
      taxCodeId: taxCodeId || null,
    })
    if (taxAmount > 0 && taxCode?.payableAccountId) {
      lines.push({
        glAccountId: taxCode.payableAccountId,
        description: `${taxCode.name} on ${tx.description.slice(0, 60)}`,
        debit: 0,
        credit: round2(taxAmount),
      })
    }
  }

  // Balance check: reject (never silently dump the remainder onto the bank line).
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    return {
      ok: false,
      status: 400,
      error: `Entry does not balance (DR ${round2(totalDebit).toFixed(2)} / CR ${round2(totalCredit).toFixed(2)})`,
    }
  }

  const memo = input.memo || tx.memo || ''
  const payee = input.payee || tx.payee || ''

  let je
  try {
    je = await createJournalEntry({
      entryDate: tx.transactionDate,
      description: `Bank: ${tx.description.slice(0, 80)}`,
      memo,
      status: 'posted',
      lines,
    })
  } catch (e) {
    const err = e as Error & { code?: string }
    // Period-lock and any other posting failure → structured error, no throw.
    const status = err.code === 'PERIOD_LOCKED' ? 423 : 400
    return { ok: false, status, error: err.message || 'Failed to post journal entry' }
  }

  await prisma.bankTransaction.update({
    where: { id: tx.id },
    data: {
      status: 'posted',
      categoryGlAccountId,
      vendorId: input.vendorId || null,
      taxCodeId: taxCodeId || null,
      memo,
      payee,
      journalEntryId: je.id,
    },
  })

  await audit({
    entityType: 'bank_transaction',
    entityId: tx.id,
    action: 'categorize',
    summary: `${tx.description.slice(0, 60)} → ${categoryAccount.accountNumber} ${categoryAccount.accountName}`,
    metadata: { journalEntryId: je.id, amount: Number(tx.amount), currency: bankAccount.currency },
  })

  return { ok: true, journalEntryId: je.id }
}
