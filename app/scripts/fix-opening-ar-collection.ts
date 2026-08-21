/**
 * Make the 2024-opening-A/R receivables collectable WITHOUT booking new revenue,
 * and WITHOUT double-relieving A/R. DRY-RUN by default; --commit to apply.
 *
 * Payment.journalEntryId is @unique, so the 2024 opening-relief LUMP (one JE that
 * moved A/R → SYS-UNDEPOSITED-FUNDS) can't be shared across payments. Instead we
 * REVERSE the lump and RE-POST it as one per-payment clearing entry each
 * (DR Clearing share / CR A/R share). Net GL change is ZERO — A/R and clearing
 * are unchanged in total; the single lump just becomes N per-payment entries — so
 * each opening-A/R payment gets its own JE and becomes matchable. No revenue is
 * booked; the 2024→2025 collection FX lands at bank-match time (→ 499).
 *
 * Idempotent: resets any payment still pointing at the lump (a prior partial run),
 * skips the reversal if already reversed (reversesId), and skips payments already
 * settled to a non-lump JE.
 *
 * Generic. Usage (on the server):
 *   npx tsx scripts/fix-opening-ar-collection.ts            # dry-run
 *   npx tsx scripts/fix-opening-ar-collection.ts --commit
 */
import 'dotenv/config'
import prisma from '../src/lib/prisma'
import { Prisma } from '../src/generated/prisma/client'
import { createJournalEntry } from '../src/lib/journalEntry'
import { reverseJournalEntry } from '../src/lib/reverseJournalEntry'
import { findArAccount } from '../src/lib/glAccounts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const f = (x: number) => x.toFixed(2)
const COMMIT = process.argv.includes('--commit')
const CUTOFF = new Date('2024-12-31T23:59:59.999Z')
const PERIOD_START = new Date('2025-01-01T00:00:00.000Z')

async function main() {
  console.log(`MODE: ${COMMIT ? 'COMMIT (writing)' : 'DRY-RUN (no writes)'}\n`)
  const ar = await findArAccount()
  const clearing = await prisma.gLAccount.findFirst({ where: { accountNumber: 'SYS-UNDEPOSITED-FUNDS' } })
  if (!ar) throw new Error('No A/R account')
  if (!clearing) throw new Error('No SYS-UNDEPOSITED-FUNDS account')

  const reliefLine = await prisma.journalEntryLine.findFirst({
    where: { glAccountId: ar.id, credit: { gt: 0 }, journalEntry: { description: { contains: 'opening', mode: 'insensitive' } } },
    orderBy: { journalEntry: { entryDate: 'desc' } },
    select: { credit: true, journalEntryId: true, journalEntry: { select: { entryNumber: true, entryDate: true, description: true } } },
  })
  if (!reliefLine) throw new Error('No opening-A/R relief JE found')
  const lumpId = reliefLine.journalEntryId
  const pool = round2(Number(reliefLine.credit))
  const lumpDate = reliefLine.journalEntry.entryDate
  console.log(`Opening-relief lump: ${reliefLine.journalEntry.entryNumber} ${lumpDate.toISOString().slice(0, 10)}  CR A/R ${f(pool)}  (id ${lumpId})\n`)

  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: PERIOD_START }, invoice: { dateIssued: { lte: CUTOFF } } },
    orderBy: { paymentDate: 'asc' },
    include: { invoice: { select: { id: true, invoiceNumber: true, currency: true } } },
  })
  if (payments.length === 0) { console.log('No opening-A/R payments — nothing to do.'); return }

  // Step 0 — undo any partial stamp that points a payment at the lump JE.
  for (const p of payments) {
    if (p.journalEntryId === lumpId) {
      console.log(`(0) reset partial stamp on payment ${p.id} (was → lump)`)
      if (COMMIT) {
        await prisma.payment.update({
          where: { id: p.id },
          data: { journalEntryId: null, cadAmount: null, cadArRelief: null, fxRate: null, fxRateDate: null },
        })
      }
    }
  }

  // Step 1 — reverse the lump once.
  const alreadyReversed = await prisma.journalEntry.findFirst({ where: { reversesId: lumpId }, select: { entryNumber: true } })
  if (alreadyReversed) {
    console.log(`(1) lump already reversed by ${alreadyReversed.entryNumber} — skip\n`)
  } else {
    console.log(`(1) reverse the lump (DR A/R ${f(pool)} / CR Clearing ${f(pool)})`)
    if (COMMIT) {
      await reverseJournalEntry(lumpId, 'Restructure 2024 opening-A/R relief into per-payment clearing')
      console.log(`    ✓ reversed`)
    }
    console.log('')
  }

  // Step 2 — re-post the relief as one per-payment clearing entry each.
  const fresh = await prisma.payment.findMany({
    where: { id: { in: payments.map((p) => p.id) } },
    orderBy: { paymentDate: 'asc' },
    include: { invoice: { select: { invoiceNumber: true, currency: true } } },
  })
  const totalNative = round2(fresh.reduce((s, p) => s + Number(p.amount), 0))
  console.log(`(2) ${fresh.length} payment(s), Σ native ${f(totalNative)}; re-posting the ${f(pool)} pool per-payment:\n`)
  let allocated = 0
  for (let i = 0; i < fresh.length; i++) {
    const p = fresh[i]
    const native = round2(Number(p.amount))
    const isLast = i === fresh.length - 1
    const share = isLast ? round2(pool - allocated) : round2((pool * native) / totalNative)
    allocated = round2(allocated + share)
    const rate = round2((share / native) * 10000) / 10000
    console.log(`  payment ${p.id}  inv ${p.invoice?.invoiceNumber}  ${f(native)} ${p.currency}  →  DR Clearing / CR A/R ${f(share)}  (own JE, cadAmount ${f(share)}, fxRate ${rate})`)
    if (COMMIT) {
      const je = await createJournalEntry({
        entryDate: p.paymentDate,
        description: `Opening A/R collected · ${p.invoice?.invoiceNumber} (settled to clearing)`,
        memo: `Per-payment split of the 2024 opening-A/R relief; payment ${p.id}`,
        status: 'posted',
        lines: [
          { glAccountId: clearing.id, description: `Undeposited funds · ${p.invoice?.invoiceNumber}`, debit: share, credit: 0 },
          { glAccountId: ar.id, description: `Relieve opening A/R · ${p.invoice?.invoiceNumber}`, debit: 0, credit: share },
        ],
      })
      await prisma.payment.update({
        where: { id: p.id },
        data: {
          cadAmount: new Prisma.Decimal(share),
          cadArRelief: new Prisma.Decimal(share),
          fxRate: new Prisma.Decimal(rate),
          fxRateDate: lumpDate,
          journalEntryId: je.id,
        },
      })
      console.log(`     ✓ ${je.entryNumber}`)
    }
  }
  console.log(`\n  Σ allocated ${f(allocated)} (= pool ${f(pool)})`)
  console.log(`  NET GL CHANGE: 0 (lump reversed −${f(pool)}, re-posted +${f(pool)} across ${fresh.length})`)
  console.log(COMMIT ? '\nDONE (committed).' : '\nDRY-RUN complete — nothing written. Re-run with --commit to apply.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
