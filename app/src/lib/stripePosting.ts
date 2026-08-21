/**
 * Pure Stripe → journal-entry posting model (no DB, no Stripe SDK — the sync
 * layer normalizes a balance transaction and resolves the account map, then
 * passes both in, so this stays unit-testable).
 *
 * The general ledger is CAD. Per Stripe balance-transaction type:
 *   charge / payment  DR clearing (net) · DR fee · CR revenue (gross)
 *                     CA non-HST → carve GST 5/105 into CR gstPayable
 *                     foreign     → revenue zero-rated (export), no GST
 *                     CA HST prov / unknown country → booked gross, flagged
 *   refund            mirror (DR revenue · CR clearing), GST reversed for CA
 *   stripe_fee        DR fee · CR clearing
 *   payout            DR payoutDestination · CR clearing
 *
 * GST place-of-supply comes from the charge's billing country/state. HST
 * provinces are flagged for human review rather than guessing the blended rate.
 */

/** GL accounts the posting model writes to (resolved/configured by the caller). */
export interface StripeAccountMap {
  /** Sales revenue (credit-normal income). */
  revenue: string
  /** Processing-fee expense. */
  fee: string
  /** Stripe balance / clearing account (asset). */
  clearing: string
  /** GST/HST payable (collected) — credit on a domestic sale. */
  gstPayable: string
  /** Account that receives payouts (e.g. the bank the payout lands in). */
  payoutDestination: string
  taxCodes: {
    /** Tax code tagging a domestic GST sale line. */
    gstIncome: string
    /** Tax code tagging a zero-rated export line. */
    zeroRated: string
  }
}

/** Normalized balance transaction (amounts already in dollars). */
export interface StripeBalanceTxnInput {
  type: string // charge | payment | refund | stripe_fee | payout
  currency: string
  amount: number // dollars, signed as Stripe reports
  fee: number // dollars
  net: number // dollars
  /** Billing country/state from the charge; null when unavailable. */
  geo: { country: string; state: string } | null
}

/**
 * Raw balance transaction as Stripe reports it: amounts in the settlement
 * currency's minor unit (cents). Structurally a subset of Stripe.BalanceTransaction,
 * so the sync layer can pass one straight through.
 */
export interface RawBalanceTxn {
  type: string
  currency: string
  amount: number // minor units (cents)
  fee: number // minor units
  net: number // minor units
}

/** Cents → dollars, rounded to 2dp. Stripe amounts are integer minor units. */
export function centsToDollars(minor: number): number {
  return round2((minor || 0) / 100)
}

/** Convert a raw (cents) balance transaction + resolved geo into the dollar-denominated posting input. */
export function normalizeStripeAmounts(
  bt: RawBalanceTxn,
  geo: { country: string; state: string } | null
): StripeBalanceTxnInput {
  return {
    type: bt.type,
    currency: bt.currency,
    amount: centsToDollars(bt.amount),
    fee: centsToDollars(bt.fee),
    net: centsToDollars(bt.net),
    geo,
  }
}

export interface PostingLine {
  glAccountId: string
  description: string
  debit: number
  credit: number
  taxCodeId?: string
}

export type PostingResult =
  | { status: 'ok'; lines: PostingLine[]; flag?: string }
  | { status: 'unhandled'; flag: string }
  | { status: 'non_cad'; flag: string }

/** HST provinces — flagged rather than carved (blended rate, place-of-supply nuance). */
export const HST_PROVINCES = new Set(['ON', 'NB', 'NL', 'NS', 'PE'])
export const GST_RATE = 0.05

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function buildStripeJournalLines(bt: StripeBalanceTxnInput, acc: StripeAccountMap): PostingResult {
  const ccy = (bt.currency || '').toLowerCase()
  if (ccy && ccy !== 'cad') return { status: 'non_cad', flag: `non-cad:${ccy}` }

  const type = bt.type

  if (type === 'charge' || type === 'payment') {
    const gross = bt.amount
    const fee = bt.fee
    const net = bt.net
    let flag: string | undefined
    const lines: PostingLine[] = [
      { glAccountId: acc.clearing, description: 'Net to Stripe balance', debit: net, credit: 0 },
      { glAccountId: acc.fee, description: 'Stripe processing fee', debit: fee, credit: 0 },
      { glAccountId: acc.revenue, description: 'Sales revenue (gross)', debit: 0, credit: gross },
    ]
    if (!bt.geo) {
      flag = 'unmatched-country'
    } else if (bt.geo.country !== 'CA') {
      lines[2] = { ...lines[2], taxCodeId: acc.taxCodes.zeroRated, description: 'Sales revenue (zero-rated export)' }
    } else if (HST_PROVINCES.has(bt.geo.state)) {
      flag = `hst-province:${bt.geo.state}`
    } else {
      const gst = round2((gross * GST_RATE) / (1 + GST_RATE))
      const netRev = round2(gross - gst)
      lines[2] = { ...lines[2], credit: netRev, taxCodeId: acc.taxCodes.gstIncome, description: 'Sales revenue (net of GST)' }
      lines.push({ glAccountId: acc.gstPayable, description: 'GST collected (5%, tax-included)', debit: 0, credit: gst, taxCodeId: acc.taxCodes.gstIncome })
    }
    return finalize(type, lines.filter((l) => l.debit !== 0 || l.credit !== 0), flag)
  }

  if (type === 'refund') {
    const abs = Math.abs(bt.amount)
    let flag: string | undefined
    const lines: PostingLine[] = [
      { glAccountId: acc.revenue, description: 'Refund (contra-revenue)', debit: abs, credit: 0 },
      { glAccountId: acc.clearing, description: 'Refund from Stripe balance', debit: 0, credit: abs },
    ]
    if (!bt.geo) {
      flag = 'unmatched-country'
    } else if (bt.geo.country !== 'CA') {
      lines[0] = { ...lines[0], taxCodeId: acc.taxCodes.zeroRated, description: 'Refund (zero-rated export)' }
    } else if (HST_PROVINCES.has(bt.geo.state)) {
      flag = `hst-province:${bt.geo.state}`
    } else {
      const gst = round2((abs * GST_RATE) / (1 + GST_RATE))
      const net = round2(abs - gst)
      lines[0] = { ...lines[0], debit: net, taxCodeId: acc.taxCodes.gstIncome, description: 'Refund (net of GST)' }
      lines.push({ glAccountId: acc.gstPayable, description: 'GST reversed on refund (5%)', debit: gst, credit: 0, taxCodeId: acc.taxCodes.gstIncome })
    }
    return finalize(type, lines, flag)
  }

  if (type === 'stripe_fee') {
    const abs = Math.abs(bt.net)
    return finalize(type, [
      { glAccountId: acc.fee, description: 'Stripe fee', debit: abs, credit: 0 },
      { glAccountId: acc.clearing, description: 'Stripe fee from balance', debit: 0, credit: abs },
    ])
  }

  if (type === 'payout') {
    const abs = Math.abs(bt.amount)
    return finalize(type, [
      { glAccountId: acc.payoutDestination, description: 'Payout received from Stripe', debit: abs, credit: 0 },
      { glAccountId: acc.clearing, description: 'Payout from Stripe balance', debit: 0, credit: abs },
    ])
  }

  return { status: 'unhandled', flag: `unhandled-type:${type}` }
}

function finalize(type: string, lines: PostingLine[], flag?: string): PostingResult {
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0))
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    return { status: 'unhandled', flag: `unbalanced:D${totalDebit}/C${totalCredit}` }
  }
  return { status: 'ok', lines, flag }
}
