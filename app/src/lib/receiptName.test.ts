import { test } from 'node:test'
import assert from 'node:assert/strict'

import { standardReceiptName, receiptDisplayName } from '@/lib/receiptName'

/**
 * Standard searchable receipt display name: YYYY-MM-DD_Vendor_AMOUNTCCY.ext.
 * Drives both the Files-manager / Receipts-inbox list AND the download filename
 * (Content-Disposition). Vendor/date/amount come from the OCR (ReceiptSchema) +
 * the linked Expense. Pure + total: never throws, always yields a safe filename.
 */

test('full data → date_vendor_amountCCY.ext', () => {
  assert.equal(
    standardReceiptName({ vendor: 'Cloudflare', date: '2025-01-15', amount: 12, currency: 'CAD', ext: '.pdf' }),
    '2025-01-15_Cloudflare_12.00CAD.pdf'
  )
})

test('accepts a Date object', () => {
  assert.equal(
    standardReceiptName({ vendor: 'Kajabi', date: new Date('2025-02-03T00:00:00Z'), amount: 159, currency: 'usd', ext: '.pdf' }),
    '2025-02-03_Kajabi_159.00USD.pdf'
  )
})

test('vendor punctuation/whitespace sanitized to hyphen tokens', () => {
  assert.equal(
    standardReceiptName({ vendor: 'Cloudflare, Inc.', date: '2025-01-15', amount: 12, currency: 'CAD', ext: '.pdf' }),
    '2025-01-15_Cloudflare-Inc_12.00CAD.pdf'
  )
  assert.equal(
    standardReceiptName({ vendor: '  The   Bramble  Works  ', date: '2025-01-15', amount: 9.9, currency: 'CAD', ext: '.pdf' }),
    '2025-01-15_The-Bramble-Works_9.90CAD.pdf'
  )
})

test('missing/blank vendor → Unknown-Vendor', () => {
  assert.equal(
    standardReceiptName({ vendor: '', date: '2025-01-15', amount: 12, currency: 'CAD', ext: '.pdf' }),
    '2025-01-15_Unknown-Vendor_12.00CAD.pdf'
  )
  assert.equal(
    standardReceiptName({ vendor: null, date: '2025-01-15', amount: 12, currency: 'CAD', ext: '.pdf' }),
    '2025-01-15_Unknown-Vendor_12.00CAD.pdf'
  )
})

test('missing/invalid date → undated', () => {
  assert.equal(
    standardReceiptName({ vendor: 'GoDaddy', date: null, amount: 44.1, currency: 'CAD', ext: '.pdf' }),
    'undated_GoDaddy_44.10CAD.pdf'
  )
  assert.equal(
    standardReceiptName({ vendor: 'GoDaddy', date: 'not-a-date', amount: 44.1, currency: 'CAD', ext: '.pdf' }),
    'undated_GoDaddy_44.10CAD.pdf'
  )
})

test('integer + missing amount → 2dp / 0.00', () => {
  assert.equal(
    standardReceiptName({ vendor: 'Vercel', date: '2025-03-01', amount: 20, currency: 'USD', ext: '.pdf' }),
    '2025-03-01_Vercel_20.00USD.pdf'
  )
  assert.equal(
    standardReceiptName({ vendor: 'Vercel', date: '2025-03-01', amount: null, currency: 'USD', ext: '.pdf' }),
    '2025-03-01_Vercel_0.00USD.pdf'
  )
})

test('missing currency → bare amount', () => {
  assert.equal(
    standardReceiptName({ vendor: 'Carrd', date: '2025-03-01', amount: 19, currency: '', ext: '.pdf' }),
    '2025-03-01_Carrd_19.00.pdf'
  )
})

test('extension normalized (adds dot, lowercased) and empty ext ok', () => {
  assert.equal(
    standardReceiptName({ vendor: 'Descript', date: '2025-03-01', amount: 24, currency: 'USD', ext: 'PDF' }),
    '2025-03-01_Descript_24.00USD.pdf'
  )
  assert.equal(
    standardReceiptName({ vendor: 'Descript', date: '2025-03-01', amount: 24, currency: 'USD', ext: '' }),
    '2025-03-01_Descript_24.00USD'
  )
})

test('long vendor truncated; unicode/emoji stripped', () => {
  const out = standardReceiptName({
    vendor: 'A'.repeat(80) + ' café ☕ services',
    date: '2025-03-01',
    amount: 5,
    currency: 'CAD',
    ext: '.pdf',
  })
  // vendor token capped at 40 chars, non-ascii dropped
  const vendorToken = out.split('_')[1]
  assert.ok(vendorToken.length <= 40, `vendor token too long: ${vendorToken.length}`)
  assert.ok(!/[^A-Za-z0-9-]/.test(vendorToken), `vendor token has unsafe chars: ${vendorToken}`)
})

test('result has no filesystem-unsafe characters', () => {
  const out = standardReceiptName({ vendor: 'A/B\\C:D*?"<>|E', date: '2025-01-15', amount: 1, currency: 'CAD', ext: '.pdf' })
  assert.ok(!/[/\\:*?"<>|]/.test(out), `unsafe char in ${out}`)
})

test('receiptDisplayName derives the extension from the original filename', () => {
  assert.equal(
    receiptDisplayName({ vendor: 'Cloudflare', date: '2025-01-15', amount: 12, currency: 'CAD', originalName: 'invoice_2842.PDF' }),
    '2025-01-15_Cloudflare_12.00CAD.pdf'
  )
  assert.equal(
    receiptDisplayName({ vendor: 'Stripe', date: '2025-01-15', amount: 0, currency: 'CAD', originalName: 'email-abc123.eml' }),
    '2025-01-15_Stripe_0.00CAD.eml'
  )
})

test('receiptDisplayName tolerates an extensionless original name', () => {
  assert.equal(
    receiptDisplayName({ vendor: 'Cloudflare', date: '2025-01-15', amount: 12, currency: 'CAD', originalName: 'receipt' }),
    '2025-01-15_Cloudflare_12.00CAD'
  )
})
