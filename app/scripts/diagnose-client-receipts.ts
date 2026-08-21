/**
 * READ-ONLY diagnosis of a client's payments / undeposited-funds state.
 *
 * Prints, for every Payment of the matched client: its amount/currency/date/
 * status, whether it is cleared to SYS-UNDEPOSITED-FUNDS (journalEntryId +
 * cadAmount set) and the GL lines of that JE, any POSTED bank transaction matched
 * to it, and the parent invoice's A/R state (total / amountPaid / cadTotal /
 * cadReliefToDate / accrued?).
 *
 * Writes NOTHING. Use to diagnose "payment not cleared to undeposited funds" /
 * "already matched to another deposit" before any repair.
 *
 * Usage (on the server, against prod):
 *   npx tsx scripts/diagnose-client-receipts.ts --client="Acme"
 *   npx tsx scripts/diagnose-client-receipts.ts --clientId=<uuid>
 */
import 'dotenv/config'
import prisma from '../src/lib/prisma'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

const n = (v: unknown) => (v == null ? null : Number(v))

async function main() {
  const clientId = arg('clientId')
  const clientName = arg('client')
  if (!clientId && !clientName) {
    console.error('Pass --client="<name>" or --clientId=<uuid>')
    process.exit(2)
  }

  const clients = await prisma.client.findMany({
    where: clientId
      ? { id: clientId }
      : {
          OR: [
            { organization: { contains: clientName as string, mode: 'insensitive' } },
            { firstName: { contains: clientName as string, mode: 'insensitive' } },
            { lastName: { contains: clientName as string, mode: 'insensitive' } },
          ],
        },
    select: { id: true, organization: true, firstName: true, lastName: true, currency: true },
  })
  if (clients.length === 0) {
    console.log('No client matched.')
    return
  }

  const clearing = await prisma.gLAccount.findFirst({ where: { accountNumber: 'SYS-UNDEPOSITED-FUNDS' }, select: { id: true } })
  console.log(`Clearing (SYS-UNDEPOSITED-FUNDS) glAccountId: ${clearing?.id ?? 'MISSING'}\n`)

  for (const c of clients) {
    const label = c.organization || `${c.firstName} ${c.lastName}`.trim()
    console.log(`================ CLIENT: ${label}  (${c.id}, ${c.currency}) ================`)

    const payments = await prisma.payment.findMany({
      where: { clientId: c.id },
      orderBy: { paymentDate: 'asc' },
      select: {
        id: true, amount: true, currency: true, paymentDate: true, status: true,
        journalEntryId: true, cadAmount: true, cadArRelief: true, fxRate: true,
        invoiceId: true,
        invoice: { select: { invoiceNumber: true, total: true, amountPaid: true, amountDue: true, status: true, cadTotal: true, cadReliefToDate: true, journalEntryId: true } },
      },
    })
    console.log(`  ${payments.length} payment(s):\n`)

    for (const p of payments) {
      const inv = p.invoice
      const cleared = !!p.journalEntryId && p.cadAmount != null
      console.log(`  • payment ${p.id}`)
      console.log(`      amount ${n(p.amount)} ${p.currency}  date ${p.paymentDate.toISOString().slice(0, 10)}  status ${p.status}`)
      console.log(`      cleared-to-undeposited: ${cleared ? 'YES' : 'NO'}  (journalEntryId=${p.journalEntryId ?? 'null'}, cadAmount=${n(p.cadAmount)}, cadArRelief=${n(p.cadArRelief)}, fxRate=${n(p.fxRate)})`)

      if (p.journalEntryId) {
        const je = await prisma.journalEntry.findUnique({
          where: { id: p.journalEntryId },
          select: { entryNumber: true, status: true, lines: { select: { debit: true, credit: true, glAccount: { select: { accountNumber: true, accountName: true } } } } },
        })
        console.log(`      JE ${je?.entryNumber} [${je?.status}]:`)
        for (const l of je?.lines ?? []) {
          console.log(`         ${l.glAccount.accountNumber} ${l.glAccount.accountName}  DR ${n(l.debit)} / CR ${n(l.credit)}`)
        }
      }

      if (inv) {
        console.log(`      invoice ${inv.invoiceNumber} [${inv.status}]  total ${n(inv.total)}  paid ${n(inv.amountPaid)}  due ${n(inv.amountDue)}  cadTotal ${n(inv.cadTotal)}  cadReliefToDate ${n(inv.cadReliefToDate)}  accrued=${inv.journalEntryId ? 'yes' : 'NO'}`)
      }

      const deposits = await prisma.bankTransaction.findMany({
        where: { matchedPaymentId: p.id },
        select: { id: true, amount: true, status: true, transactionDate: true, journalEntryId: true, description: true },
      })
      if (deposits.length) {
        for (const d of deposits) {
          console.log(`      ⚠ matched bank deposit ${d.id} [${d.status}]  ${n(d.amount)}  ${d.transactionDate.toISOString().slice(0, 10)}  je=${d.journalEntryId ?? 'null'}  "${d.description.slice(0, 60)}"`)
        }
      }
      console.log('')
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
