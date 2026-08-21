import { test } from 'node:test'
import assert from 'node:assert/strict'

import { cleanVendor } from '@/lib/cleanVendor'

/**
 * Post-OCR vendor sanitiser. The merchant must come from the document/email
 * CONTENT, never the shared-mailbox/workspace chrome, our own org name, a bare
 * email, or a doc-type word. On rejection it returns null so the caller leaves
 * the vendor blank rather than mislabel the receipt + create a junk Vendor row.
 */

const ORG = ['The Bramble Works Inc.', 'ZORVO']

test('rejects shared-mailbox / workspace chrome', () => {
  assert.equal(cleanVendor('ZORVO Collective Mail', { ownOrgNames: ORG }), null)
  assert.equal(cleanVendor('Gmail', {}), null)
  assert.equal(cleanVendor('Acme Mail', {}), null)
  assert.equal(cleanVendor('Google Workspace', {}), null)
})

test('rejects our own org name + alias (config-injected, not hardcoded)', () => {
  assert.equal(cleanVendor('The Bramble Works Inc.', { ownOrgNames: ORG }), null)
  assert.equal(cleanVendor('the bramble works', { ownOrgNames: ORG }), null)
  assert.equal(cleanVendor('ZORVO', { ownOrgNames: ORG }), null)
})

test('rejects a bare email address', () => {
  assert.equal(cleanVendor('billing@vendor.com', {}), null)
  assert.equal(cleanVendor('no-reply@stripe.com', {}), null)
})

test('rejects doc-type-only strings', () => {
  assert.equal(cleanVendor('Transaction Invoice', {}), null)
  assert.equal(cleanVendor('Receipt', {}), null)
  assert.equal(cleanVendor('Order Confirmation', {}), null)
})

test('keeps a real merchant unchanged', () => {
  assert.equal(cleanVendor('TELUS', {}), 'TELUS')
  assert.equal(cleanVendor('GoDaddy.com', {}), 'GoDaddy.com')
  assert.equal(cleanVendor('Google LLC', { ownOrgNames: ORG }), 'Google LLC')
})

test('collapses whitespace, trims', () => {
  assert.equal(cleanVendor('  Cloudflare   Inc  ', {}), 'Cloudflare Inc')
})

test('null / empty / whitespace → null', () => {
  assert.equal(cleanVendor(null, {}), null)
  assert.equal(cleanVendor(undefined, {}), null)
  assert.equal(cleanVendor('   ', {}), null)
})
