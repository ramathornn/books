/**
 * Repair a client's undeposited-funds state so its receipts become matchable.
 * DRY-RUN by default (writes nothing); pass --commit to apply.
 *
 * Two operations, both idempotent:
 *  (A) Unwind a wrong deposit→payment link: reverse the deposit's clearing→bank
 *      JE (cash back to undeposited) and return the bank tx to pending. The
 *      pre-existing payment is LEFT cleared (not deleted).
 *  (B) Accrue + settle un-cleared standalone payments to SYS-UNDEPOSITED-FUNDS:
 *      DR Undeposited (cadCleared) / CR A/R (accrual-basis relief) / 499 (realized
 *      FX), and stamp cadAmount/cadArRelief/fxRate/journalEntryId on the Payment.
 *      Skips invoices in a locked period and payments already cleared.
 *
 * Generic — no hardcoded names. Usage (on the server, against prod):
 *   npx tsx scripts/fix-client-undeposited.ts --client="Acme" \
 *     --unwind-deposit=<bankTxId> --since=2025-01-01            # dry-run
 *   ... --commit                                                # apply
 */
import 'dotenv/config'
import prisma from '../src/lib/prisma'
import { Prisma } from '../src/generated/prisma/client'
import { createJournalEntry } from '../src/lib/journalEntry'
import { reverseJournalEntry } from '../src/lib/reverseJournalEntry'
import { postInvoiceAccrual } from '../src/lib/invoicePosting'
import { findArAccount } from '../src/lib/glAccounts'
import { findRealizedFxAccount } from '../src/lib/fxAccounts'
import { getCadRate } from '../src/lib/fx'
import { getPeriodLock } from '../src/lib/periodLock'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const fmt = (n: number) => n.toFixed(2)
const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const COMMIT = process.argv.includes('--commit')

async function main() {
  const clientName = arg('client')
  const since = new Date(arg('since') || '2025-01-01')
  const unwindIds = process.argv.filter((a) => a.startsWith('--unwind-deposit=')).map((a) => a.split('=')[1])
  if (!clientName) {
    console.error('Pass --client="<name>"')
    process.exit(2)
  }
  console.log(`MODE: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}\n`)

  const lock = await getPeriodLock()
  const lockedThrough = lock.lockedThrough
  const ar = await findArAccount()
  const clearing = await prisma.gLAccount.findFirst({ where: { accountNumber: 'SYS-UNDEPOSITED-FUNDS' } })
  if (!ar) throw new Error('No A/R account')
  if (!clearing) throw new Error('No SYS-UNDEPOSITED-FUNDS account')

  // ── (A) Unwind wrong deposit links ──
  for (const id of unwindIds) {
    const tx = await prisma.bankTransaction.findUnique({
      where: { id },
      include: { bankAccount: { include: { glAccount: true } } },
    })
    if (!tx) { console.log(`(A) deposit ${id}: NOT FOUND — skip`); continue }
    console.log(`(A) Unwind deposit ${id}  ${fmt(Number(tx.amount))}  ${tx.transactionDate.toISOString().slice(0, 10)}  status=${tx.status}`)
    console.log(`      → reverse JE ${tx.journalEntryId ?? '(none)'} (cash back to undeposited), set bank tx → pending, clear match links`)
    console.log(`      → the matched payment (${tx.matchedPaymentId ?? 'none'}) stays cleared (NOT deleted)`)
    if (COMMIT) {
      if (tx.status !== 'posted') {
        console.log(`      · already not posted — skipping`)
      } else {
        if (tx.journalEntryId) await reverseJournalEntry(tx.journalEntryId, `Unwind wrong deposit match (${id})`)
        await prisma.bankTransaction.update({
          where: { id: tx.id },
          data: {
            status: 'pending', journalEntryId: null, transferPairId: null,
            matchedInvoiceId: null, matchedPaymentId: null, matchedExpenseId: null,
            categoryGlAccountId: null, isReconciled: false, reconciledAt: null,
          },
        })
        console.log(`      ✓ reversed`)
      }
    }
    console.log('')
  }

  // ── (B) Accrue + settle un-cleared standalone payments ──
  const client = await prisma.client.findFirst({
    where: { OR: [
      { organization: { contains: clientName, mode: 'insensitive' } },
      { firstName: { contains: clientName, mode: 'insensitive' } },
      { lastName: { contains: clientName, mode: 'insensitive' } },
    ] },
    select: { id: true, organization: true, firstName: true, lastName: true },
  })
  if (!client) { console.log('No client matched for (B).'); return }
  const label = client.organization || `${client.firstName} ${client.lastName}`.trim()

  const payments = await prisma.payment.findMany({
    where: { clientId: client.id, paymentDate: { gte: since }, journalEntryId: null },
    orderBy: { paymentDate: 'asc' },
    include: { invoice: true },
  })
  console.log(`(B) ${label}: ${payments.length} un-cleared payment(s) since ${since.toISOString().slice(0, 10)}\n`)

  let fxAcct: { id: string } | null = null
  try { fxAcct = await findRealizedFxAccount() } catch { /* may be unused for CAD */ }

  for (const p of payments) {
    const inv = p.invoice
    if (!inv) { console.log(`  payment ${p.id}: no invoice — skip`); continue }
    const issue = inv.dateIssued
    if (lockedThrough && issue.getTime() <= lockedThrough.getTime()) {
      console.log(`  payment ${p.id} (inv ${inv.invoiceNumber}): issue ${issue.toISOString().slice(0, 10)} is in the LOCKED period (≤ ${lockedThrough.toISOString().slice(0, 10)}) — SKIP`)
      continue
    }
    const isCad = (inv.currency || 'CAD').toUpperCase() === 'CAD'
    const accrualRate = isCad ? { rate: 1, source: 'IDENTITY' } : await getCadRate(inv.currency, inv.dateIssued)
    const settleRate = isCad ? { rate: 1 } : await getCadRate(p.currency, p.paymentDate)
    const cadTotalPreview = round2(Number(inv.total) * accrualRate.rate) // accrual basis (issue-date)
    const cadCleared = round2(Number(p.amount) * settleRate.rate)        // cash in clearing (payment-date)
    const arRelief = cadTotalPreview                                     // full payment → relieve full accrual
    const realizedFx = round2(cadCleared - arRelief)

    console.log(`  payment ${p.id}  ${fmt(Number(p.amount))} ${p.currency}  ${p.paymentDate.toISOString().slice(0, 10)}  inv ${inv.invoiceNumber} [${inv.status}] accrued=${inv.journalEntryId ? 'yes' : 'NO'}`)
    console.log(`      accrue @ ${accrualRate.rate} (issue ${inv.dateIssued.toISOString().slice(0, 10)}) → cadTotal ${fmt(cadTotalPreview)}  [DR A/R / CR Sales(+GST)]`)
    console.log(`      settle @ ${settleRate.rate} (pay ${p.paymentDate.toISOString().slice(0, 10)}) → DR Undeposited ${fmt(cadCleared)} / CR A/R ${fmt(arRelief)} / 499 ${fmt(realizedFx)}`)

    if (COMMIT) {
      if (!inv.journalEntryId) await postInvoiceAccrual(inv.id)
      const fresh = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })
      const cadTotal = Number(fresh.cadTotal ?? 0)
      const cadReliefToDate = Number(fresh.cadReliefToDate)
      const relief = round2(cadTotal - cadReliefToDate) // final payment → exact remaining
      const cleared = round2(Number(p.amount) * settleRate.rate)
      const fx = round2(cleared - relief)
      const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = [
        { glAccountId: clearing.id, description: `Undeposited funds · ${inv.invoiceNumber}`, debit: cleared, credit: 0 },
        { glAccountId: ar.id, description: `Payment ${inv.invoiceNumber}`, debit: 0, credit: relief },
      ]
      if (Math.abs(fx) > 0.005 && fxAcct) {
        if (fx > 0) lines.push({ glAccountId: fxAcct.id, description: `Realized FX gain · ${inv.invoiceNumber}`, debit: 0, credit: fx })
        else lines.push({ glAccountId: fxAcct.id, description: `Realized FX loss · ${inv.invoiceNumber}`, debit: -fx, credit: 0 })
      }
      const je = await createJournalEntry({
        entryDate: p.paymentDate,
        description: `Payment for invoice ${inv.invoiceNumber} (repair settlement → clearing)`,
        memo: `Standalone payment ${p.id} settled to undeposited funds at CAD basis`,
        status: 'posted',
        lines,
      })
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          cadAmount: new Prisma.Decimal(cleared),
          cadArRelief: new Prisma.Decimal(relief),
          fxRate: new Prisma.Decimal(settleRate.rate),
          fxRateDate: p.paymentDate,
          journalEntryId: je.id,
        },
      })
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { cadReliefToDate: new Prisma.Decimal(round2(cadReliefToDate + relief)) },
      })
      console.log(`      ✓ accrued + settled → ${je.entryNumber}`)
    }
    console.log('')
  }
  console.log(COMMIT ? 'DONE (committed).' : 'DRY-RUN complete — nothing written. Re-run with --commit to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
