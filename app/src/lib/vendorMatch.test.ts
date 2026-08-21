import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchVendor, normalizeMerchant, type VendorLite } from './vendorMatch'

const VENDORS: VendorLite[] = [
  { id: 'v-godaddy', name: 'GoDaddy.com' },
  { id: 'v-do', name: 'DigitalOcean LLC' },
  { id: 'v-anthropic', name: 'Anthropic, PBC' },
]

const NO_ALIASES = new Map<string, string>()

test('normalizeMerchant strips case + punctuation to a stable key', () => {
  assert.equal(normalizeMerchant('DNH*GoDaddy.com'), 'dnhgodaddycom')
  assert.equal(normalizeMerchant('  Amazon  '), 'amazon')
  assert.equal(normalizeMerchant(null), '')
})

test('alias tier wins over everything (highest confidence)', () => {
  const aliases = new Map([['dnhgodaddy', 'v-do']]) // deliberately points at DO
  const r = matchVendor('DNH*GODADDY', VENDORS, aliases)
  assert.deepEqual(r, { vendorId: 'v-do', confidence: 'alias' })
})

test('exact tier: normalised-name equality (case/punct-insensitive)', () => {
  const r = matchVendor('digitalocean llc', VENDORS, NO_ALIASES)
  assert.deepEqual(r, { vendorId: 'v-do', confidence: 'exact' })
})

test('strong tier: squished descriptor resolves via distinctive token', () => {
  const r = matchVendor('DNH*GODADDY', VENDORS, NO_ALIASES)
  assert.deepEqual(r, { vendorId: 'v-godaddy', confidence: 'strong' })
})

test('strong tier: split brand name ("ANTHRO PIC") resolves', () => {
  const r = matchVendor('ANTHRO PIC SAN FRANCISCO', VENDORS, NO_ALIASES)
  assert.deepEqual(r, { vendorId: 'v-anthropic', confidence: 'strong' })
})

test('ambiguous: two vendors share a distinctive token → no auto-pick', () => {
  const vendors: VendorLite[] = [
    { id: 'v-ads', name: 'Google Ads' },
    { id: 'v-cloud', name: 'Google Cloud' },
  ]
  const r = matchVendor('GOOGLE CLOUD PLATFORM', vendors, NO_ALIASES)
  assert.equal(r.vendorId, null)
  assert.equal((r as { confidence: string }).confidence, 'ambiguous')
})

test('none: unrecognised merchant → suggest creating it from the cleaned descriptor', () => {
  const r = matchVendor('SOME NEW SHOP 123', VENDORS, NO_ALIASES)
  assert.equal(r.vendorId, null)
  assert.deepEqual(r, { vendorId: null, confidence: 'none', suggestName: 'SOME NEW SHOP 123' })
})

test('junk merchant → suggestName null (cleanVendor rejects email/chrome)', () => {
  const r = matchVendor('billing@vendor.com', VENDORS, NO_ALIASES)
  assert.deepEqual(r, { vendorId: null, confidence: 'none', suggestName: null })
})
