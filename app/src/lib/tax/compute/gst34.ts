import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'

/**
 * GST34 line computation.
 *
 * Wraps the same GL query the existing `/api/sales-tax/preview` route uses (sum
 * of credits to GST/HST Payable = collected; sum of debits = ITCs, single
 * 2315-account convention), and maps the result onto the official GST34 line
 * numbers.
 *
 * Line 101  sales & other revenue (supplies; FX gains / interest excluded — §6 Q4)
 * Line 103  GST/HST collected/collectible
 * Line 105  total GST/HST and adjustments (= 103 + 104)
 * Line 106  ITCs
 * Line 108  total ITCs and adjustments (= 106 + 107)
 * Line 109  net tax (= 105 − 108); negative ⇒ refund
 *
 * `computeGst34Lines` is the pure mapper; `computeGst34` is the DB adapter.
 */

export interface Gst34Lines {
  line101: number // sales and other revenue
  line103: number // GST/HST collected or collectible
  line104: number // adjustments (added to 103)
  line105: number // total (103 + 104)
  line106: number // ITCs
  line107: number // adjustments (added to 106)
  line108: number // total ITCs and adjustments (106 + 107)
  line109: number // net tax (105 − 108)
}

export interface Gst34Input {
  revenue: number
  collected: number
  itcs: number
  line104?: number
  line107?: number
}

/** Pure: assemble the GST34 lines from raw period totals. */
export function computeGst34Lines(input: Gst34Input): Gst34Lines {
  const line101 = round2(input.revenue)
  const line103 = round2(input.collected)
  const line104 = round2(input.line104 ?? 0)
  const line105 = round2(line103 + line104)
  const line106 = round2(input.itcs)
  const line107 = round2(input.line107 ?? 0)
  const line108 = round2(line106 + line107)
  const line109 = round2(line105 - line108)
  return { line101, line103, line104, line105, line106, line107, line108, line109 }
}

export interface Gst34ComputeResult {
  lines: Gst34Lines
  sourceRef: {
    gstPayableAccountId: string | null
    periodStart: string
    periodEnd: string
    collected: number
    itcs: number
    revenue: number
    journalEntryLineCount: number
  }
}

/**
 * DB adapter: replicate the sales-tax/preview GL query over a period and emit
 * GST34 lines. Line 101 revenue is summed from posted credits to income
 * accounts excluding non-supply accounts (FX gains / interest) when those are
 * configured; absent that config it sums all income-class credits.
 */
export async function computeGst34({
  start,
  end,
  gstPayableAccountId,
  excludeIncomeAccountIds = [],
}: {
  start: Date
  end: Date
  gstPayableAccountId?: string | null
  excludeIncomeAccountIds?: string[]
}): Promise<Gst34ComputeResult> {
  const periodEnd = new Date(end)
  // UTC: period dates are UTC calendar-date instants (date-only strings parse to
  // UTC midnight). Local setHours on a non-UTC box would end the period hours
  // into its last day, dropping late-day timestamped entries into no period.
  periodEnd.setUTCHours(23, 59, 59, 999)

  let gstPayable = gstPayableAccountId
    ? await prisma.gLAccount.findUnique({ where: { id: gstPayableAccountId } })
    : null
  if (!gstPayable) {
    const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
    if (settings?.defaultGstPayableAccountId) {
      gstPayable = await prisma.gLAccount.findUnique({
        where: { id: settings.defaultGstPayableAccountId },
      })
    }
    if (!gstPayable) {
      gstPayable = await prisma.gLAccount.findFirst({ where: { accountNumber: '2315' } })
    }
  }

  let collected = 0
  let itcs = 0
  let journalEntryLineCount = 0
  if (gstPayable) {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        glAccountId: gstPayable.id,
        journalEntry: { status: 'posted', entryDate: { gte: start, lte: periodEnd } },
      },
      select: { debit: true, credit: true },
    })
    for (const l of lines) {
      collected += Number(l.credit || 0)
      itcs += Number(l.debit || 0)
    }
    journalEntryLineCount = lines.length
  }

  // Line 101 revenue: net credits to income-class accounts (supplies), minus
  // any explicitly excluded non-supply accounts (realized FX, interest).
  const incomeAccounts = await prisma.gLAccount.findMany({
    where: { accountClass: 'income', id: { notIn: excludeIncomeAccountIds } },
    select: { id: true },
  })
  let revenue = 0
  if (incomeAccounts.length > 0) {
    const revLines = await prisma.journalEntryLine.findMany({
      where: {
        glAccountId: { in: incomeAccounts.map((a) => a.id) },
        journalEntry: { status: 'posted', entryDate: { gte: start, lte: periodEnd } },
      },
      select: { debit: true, credit: true },
    })
    for (const l of revLines) {
      revenue += Number(l.credit || 0) - Number(l.debit || 0)
    }
  }

  return {
    lines: computeGst34Lines({ revenue, collected, itcs }),
    sourceRef: {
      gstPayableAccountId: gstPayable?.id ?? null,
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: periodEnd.toISOString().slice(0, 10),
      collected: round2(collected),
      itcs: round2(itcs),
      revenue: round2(revenue),
      journalEntryLineCount,
    },
  }
}
