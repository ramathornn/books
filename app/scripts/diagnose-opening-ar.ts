/**
 * READ-ONLY: investigate the 2024 opening/closing A/R and which invoices it
 * represents. Writes nothing.
 *
 *  - prints the "Opening balance migration" + opening-relief-lump JEs touching A/R
 *  - lists every invoice issued ON/BEFORE 2024-12-31 that was collected by a
 *    payment dated ON/AFTER 2025-01-01 (i.e. a receivable outstanding at the 2024
 *    year-end, collected in the current period) — these are what the opening A/R
 *    represents — with EUR + a CAD-at-issue estimate, and the running sum
 *  - prints the current SYS-UNDEPOSITED-FUNDS (clearing) balance
 */
import 'dotenv/config'
import prisma from '../src/lib/prisma'
import { getCadRate } from '../src/lib/fx'
import { findArAccount } from '../src/lib/glAccounts'

const n = (v: unknown) => (v == null ? 0 : Number(v))
const f = (x: number) => x.toFixed(2)
const CUTOFF = new Date('2024-12-31T23:59:59.999Z')
const PERIOD_START = new Date('2025-01-01T00:00:00.000Z')

async function main() {
  const ar = await findArAccount()
  const clearing = await prisma.gLAccount.findFirst({ where: { accountNumber: 'SYS-UNDEPOSITED-FUNDS' } })
  console.log(`A/R acct: ${ar?.accountNumber}  balance ${f(n(ar?.currentBalance))}`)
  console.log(`Clearing (SYS-UNDEPOSITED-FUNDS) balance: ${f(n(clearing?.currentBalance))}\n`)

  // JEs that credit/debit A/R with "opening" in the description.
  const openingLines = await prisma.journalEntryLine.findMany({
    where: { glAccountId: ar?.id, journalEntry: { OR: [
      { description: { contains: 'opening', mode: 'insensitive' } },
      { description: { contains: 'Opening balance migration', mode: 'insensitive' } },
    ] } },
    select: { debit: true, credit: true, description: true, journalEntry: { select: { entryNumber: true, entryDate: true, description: true } } },
  })
  console.log('=== A/R lines on "opening" JEs ===')
  for (const l of openingLines) {
    console.log(`  ${l.journalEntry.entryNumber} ${l.journalEntry.entryDate.toISOString().slice(0, 10)} "${l.journalEntry.description}"  DR ${f(n(l.debit))} / CR ${f(n(l.credit))}`)
  }
  console.log('')

  // Invoices issued <= 2024-12-31 with a payment dated >= 2025-01-01 (collected in current period).
  const payments = await prisma.payment.findMany({
    where: { paymentDate: { gte: PERIOD_START }, invoice: { dateIssued: { lte: CUTOFF } } },
    orderBy: { paymentDate: 'asc' },
    select: {
      id: true, amount: true, currency: true, paymentDate: true, journalEntryId: true, cadAmount: true,
      invoice: { select: { invoiceNumber: true, dateIssued: true, currency: true, total: true } },
      client: { select: { organization: true, firstName: true, lastName: true } },
    },
  })
  console.log(`=== Invoices issued ≤2024-12-31, collected ≥2025-01-01 (${payments.length}) ===`)
  let sumCadAtIssue = 0
  for (const p of payments) {
    const inv = p.invoice!
    const isCad = (inv.currency || 'CAD').toUpperCase() === 'CAD'
    let rate = 1
    try { rate = isCad ? 1 : (await getCadRate(inv.currency, inv.dateIssued)).rate } catch { rate = 0 }
    const cadAtIssue = rate ? Math.round(n(inv.total) * rate * 100) / 100 : 0
    sumCadAtIssue += cadAtIssue
    const who = p.client?.organization || `${p.client?.firstName ?? ''} ${p.client?.lastName ?? ''}`.trim()
    console.log(`  inv ${inv.invoiceNumber}  ${f(n(p.amount))} ${p.currency}  issued ${inv.dateIssued.toISOString().slice(0, 10)}  paid ${p.paymentDate.toISOString().slice(0, 10)}  ~CAD@issue ${f(cadAtIssue)}  cleared=${p.journalEntryId ? 'yes' : 'NO'}  [${who}]`)
  }
  console.log(`\n  Σ CAD-at-issue ≈ ${f(sumCadAtIssue)}   (compare to the opening A/R lump above)`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
