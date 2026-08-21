import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStripeJournalLines,
  centsToDollars,
  normalizeStripeAmounts,
  type StripeAccountMap,
  type StripeBalanceTxnInput,
} from './stripePosting'

const ACC: StripeAccountMap = {
  revenue: 'REV',
  fee: 'FEE',
  clearing: 'CLR',
  gstPayable: 'GST',
  payoutDestination: 'BANK',
  taxCodes: { gstIncome: 'TC_GST', zeroRated: 'TC_ZERO' },
}

function charge(over: Partial<StripeBalanceTxnInput> = {}): StripeBalanceTxnInput {
  return { type: 'charge', currency: 'cad', amount: 105, fee: 3, net: 102, geo: { country: 'CA', state: 'AB' }, ...over }
}

function balanced(lines: { debit: number; credit: number }[]) {
  const d = lines.reduce((s, l) => s + l.debit, 0)
  const c = lines.reduce((s, l) => s + l.credit, 0)
  return Math.abs(d - c) < 0.005
}

test('CA non-HST charge carves GST 5/105 and balances', () => {
  const r = buildStripeJournalLines(charge({ amount: 105, fee: 3, net: 102 }), ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.ok(balanced(r.lines))
  const gstLine = r.lines.find((l) => l.glAccountId === 'GST')
  assert.ok(gstLine, 'has a GST line')
  assert.equal(gstLine!.credit, 5) // 105 * 5/105 = 5.00
  const rev = r.lines.find((l) => l.glAccountId === 'REV')!
  assert.equal(rev.credit, 100) // 105 - 5
  assert.equal(rev.taxCodeId, 'TC_GST')
  assert.equal(r.flag, undefined)
})

test('foreign charge → revenue zero-rated, no GST line', () => {
  const r = buildStripeJournalLines(charge({ geo: { country: 'US', state: 'CA' } }), ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.ok(balanced(r.lines))
  assert.equal(r.lines.find((l) => l.glAccountId === 'GST'), undefined)
  const rev = r.lines.find((l) => l.glAccountId === 'REV')!
  assert.equal(rev.credit, 105) // full gross, zero-rated
  assert.equal(rev.taxCodeId, 'TC_ZERO')
})

test('CA HST province charge is flagged, booked gross (no carve)', () => {
  const r = buildStripeJournalLines(charge({ geo: { country: 'CA', state: 'ON' } }), ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.equal(r.flag, 'hst-province:ON')
  assert.equal(r.lines.find((l) => l.glAccountId === 'GST'), undefined)
  assert.equal(r.lines.find((l) => l.glAccountId === 'REV')!.credit, 105)
})

test('charge with unknown country is flagged, booked gross', () => {
  const r = buildStripeJournalLines(charge({ geo: null }), ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.equal(r.flag, 'unmatched-country')
  assert.equal(r.lines.find((l) => l.glAccountId === 'REV')!.credit, 105)
})

test('zero-fee charge drops the empty fee line', () => {
  const r = buildStripeJournalLines(charge({ amount: 105, fee: 0, net: 105 }), ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.equal(r.lines.find((l) => l.glAccountId === 'FEE'), undefined)
  assert.ok(balanced(r.lines))
})

test('CA refund mirrors the sale and reverses GST', () => {
  const r = buildStripeJournalLines(
    { type: 'refund', currency: 'cad', amount: -105, fee: 0, net: -105, geo: { country: 'CA', state: 'AB' } },
    ACC
  )
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.ok(balanced(r.lines))
  const gst = r.lines.find((l) => l.glAccountId === 'GST')!
  assert.equal(gst.debit, 5) // GST reversed (debit)
  const rev = r.lines.find((l) => l.glAccountId === 'REV')!
  assert.equal(rev.debit, 100) // contra-revenue net of GST
})

test('foreign refund → zero-rated contra-revenue, no GST', () => {
  const r = buildStripeJournalLines(
    { type: 'refund', currency: 'cad', amount: -50, fee: 0, net: -50, geo: { country: 'US', state: '' } },
    ACC
  )
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.equal(r.lines.find((l) => l.glAccountId === 'GST'), undefined)
  assert.equal(r.lines.find((l) => l.glAccountId === 'REV')!.debit, 50)
})

test('stripe_fee → DR fee / CR clearing', () => {
  const r = buildStripeJournalLines({ type: 'stripe_fee', currency: 'cad', amount: 0, fee: 0, net: -2.5, geo: null }, ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.deepEqual(
    r.lines.map((l) => [l.glAccountId, l.debit, l.credit]),
    [['FEE', 2.5, 0], ['CLR', 0, 2.5]]
  )
})

test('payout → DR payout destination / CR clearing', () => {
  const r = buildStripeJournalLines({ type: 'payout', currency: 'cad', amount: -200, fee: 0, net: -200, geo: null }, ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.deepEqual(
    r.lines.map((l) => [l.glAccountId, l.debit, l.credit]),
    [['BANK', 200, 0], ['CLR', 0, 200]]
  )
})

test('non-CAD settlement is left unbooked', () => {
  const r = buildStripeJournalLines(charge({ currency: 'usd' }), ACC)
  assert.equal(r.status, 'non_cad')
})

test('unknown balance-transaction type is unhandled', () => {
  const r = buildStripeJournalLines({ type: 'adjustment', currency: 'cad', amount: 1, fee: 0, net: 1, geo: null }, ACC)
  assert.equal(r.status, 'unhandled')
})

test('GST carve handles odd cents and still balances', () => {
  // 99.99 gross → gst = round2(99.99 * 5/105) = 4.76, net rev 95.23
  const r = buildStripeJournalLines(charge({ amount: 99.99, fee: 2.99, net: 97.0 }), ACC)
  assert.equal(r.status, 'ok')
  if (r.status !== 'ok') return
  assert.ok(balanced(r.lines))
  assert.equal(r.lines.find((l) => l.glAccountId === 'GST')!.credit, 4.76)
})

test('centsToDollars converts integer minor units to 2dp dollars', () => {
  assert.equal(centsToDollars(10500), 105)
  assert.equal(centsToDollars(299), 2.99)
  assert.equal(centsToDollars(0), 0)
  assert.equal(centsToDollars(-20000), -200) // payouts/refunds report negative
})

test('normalizeStripeAmounts maps a raw (cents) Stripe txn into the dollar posting input', () => {
  const input = normalizeStripeAmounts(
    { type: 'charge', currency: 'cad', amount: 10500, fee: 300, net: 10200 },
    { country: 'CA', state: 'AB' }
  )
  assert.deepEqual(input, {
    type: 'charge',
    currency: 'cad',
    amount: 105,
    fee: 3,
    net: 102,
    geo: { country: 'CA', state: 'AB' },
  })
})

test('normalize → build posts the same JE a dollar-denominated charge would (cents end-to-end)', () => {
  const fromCents = buildStripeJournalLines(
    normalizeStripeAmounts({ type: 'charge', currency: 'cad', amount: 10500, fee: 300, net: 10200 }, { country: 'CA', state: 'AB' }),
    ACC
  )
  const fromDollars = buildStripeJournalLines(charge({ amount: 105, fee: 3, net: 102 }), ACC)
  assert.deepEqual(fromCents, fromDollars)
})
