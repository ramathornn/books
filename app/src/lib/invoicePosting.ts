import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { reverseJournalEntry } from '@/lib/reverseJournalEntry'
import { getCadRate, convertInvoiceToCad, toAccountingDate } from '@/lib/fx'
import { findArAccount, findSalesAccount, findGstPayableAccount } from '@/lib/glAccounts'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const STATUSES_TO_ACCRUE = new Set(['sent', 'viewed', 'partial', 'paid'])

export async function postInvoiceAccrual(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice) throw new Error('Invoice not found')
  if (invoice.journalEntryId) return invoice
  if (!STATUSES_TO_ACCRUE.has(invoice.status)) throw new Error(`Invoice ${invoice.invoiceNumber} status '${invoice.status}' is not accruable`)
  const ar = await findArAccount(); const sales = await findSalesAccount()
  if (!ar) throw new Error('No A/R account in chart')
  if (!sales) throw new Error('No Sales/income account in chart')
  const isCad = invoice.currency.toUpperCase() === 'CAD'
  const issueDate = toAccountingDate(invoice.dateIssued)
  let rate = 1; let rateDate = issueDate; let source = 'IDENTITY'
  if (!isCad) { const r = await getCadRate(invoice.currency, invoice.dateIssued); rate = r.rate; rateDate = r.rateDate; source = r.source }
  const subtotal = Number(invoice.subtotal); const discount = Number(invoice.discount)
  const taxTotal = isCad ? Number(invoice.taxTotal) : 0
  const total = isCad ? Number(invoice.total) : subtotal - discount
  const { cadSubtotal, cadTaxTotal, cadTotal } = convertInvoiceToCad(subtotal, taxTotal, discount, total, rate, { exactTaxFace: isCad })
  const lines: Array<{ glAccountId: string; description: string; debit: number; credit: number; taxCodeId?: string | null }> = [
    { glAccountId: ar.id, description: `A/R · ${invoice.invoiceNumber}`, debit: cadTotal, credit: 0 },
  ]
  let gstAcct: { id: string } | null = null
  if (isCad && cadTaxTotal > 0) { gstAcct = await findGstPayableAccount(); if (!gstAcct) throw new Error('No GST/HST Payable (2315) account in chart') }
  const salesCredit = round2(cadTotal - (gstAcct ? cadTaxTotal : 0))
  lines.push({ glAccountId: sales.id, description: `Sales · ${invoice.invoiceNumber}`, debit: 0, credit: salesCredit })
  if (gstAcct) lines.push({ glAccountId: gstAcct.id, description: `GST collected · ${invoice.invoiceNumber}`, debit: 0, credit: cadTaxTotal })
  const td = lines.reduce((s, l) => s + l.debit, 0); const tc = lines.reduce((s, l) => s + l.credit, 0)
  if (Math.abs(td - tc) > 0.005) throw new Error(`Accrual for ${invoice.invoiceNumber} does not balance (DR ${td.toFixed(2)} / CR ${tc.toFixed(2)})`)
  return prisma.$transaction(async (tx) => {
    const je = await createJournalEntry({
      entryDate: issueDate, description: `Invoice accrual ${invoice.invoiceNumber}`,
      memo: isCad ? '' : `FX ${invoice.currency}→CAD @ ${rate} (${source}, ${rateDate.toISOString().slice(0, 10)})`,
      status: 'posted', kind: 'standard', lines, client: tx,
    })
    return tx.invoice.update({ where: { id: invoice.id }, data: {
      journalEntryId: je.id, fxRate: new Prisma.Decimal(rate), fxRateSource: source, fxRateDate: rateDate,
      cadTotal: new Prisma.Decimal(cadTotal), cadSubtotal: new Prisma.Decimal(cadSubtotal), cadTaxTotal: new Prisma.Decimal(cadTaxTotal),
    } })
  })
}

export async function unpostInvoiceAccrual(invoiceId: string, reason = 'Invoice accrual unposted') {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
  if (!invoice || !invoice.journalEntryId) return invoice
  await reverseJournalEntry(invoice.journalEntryId, reason)
  return prisma.invoice.update({ where: { id: invoice.id }, data: {
    voidJournalEntryId: invoice.journalEntryId, voidedAt: new Date(), journalEntryId: null,
    fxRate: null, fxRateSource: '', fxRateDate: null, cadTotal: null, cadSubtotal: null, cadTaxTotal: null, cadReliefToDate: 0,
  } })
}
