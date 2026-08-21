import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectMatch, vendorTokens, type JeCandidate } from './jeMatch'

// A posted expense JE the matcher might attach a receipt to. entryDate windowing
// is done by the DB query; selectMatch receives only same-window candidates and
// decides on amount + vendor.
function je(partial: Partial<JeCandidate> & { id: string }): JeCandidate {
  return {
    id: partial.id,
    entryDate: partial.entryDate ?? new Date('2026-06-19'),
    totalDebit: partial.totalDebit ?? 0,
    description: partial.description ?? '',
    memo: partial.memo ?? '',
  }
}

test('confident match: a unique candidate with matching amount + vendor token', () => {
  const r = selectMatch(
    { vendor: 'Flodesk', total: 19, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 19, description: 'Flodesk monthly subscription' })]
  )
  assert.equal(r.je?.id, 'JE-1')
  assert.equal(r.ambiguous, false)
})

test('vendor alias: an "Anthropic" receipt matches a "Claude.ai" JE (same company)', () => {
  // The Amex statement descriptor is CLAUDE.AI SUBSCRIPTION but the receipt is
  // from "Anthropic, PBC" — without aliasing the vendor tokens never overlap.
  const r = selectMatch(
    { vendor: 'Anthropic, PBC', total: 280, date: '2026-05-29' },
    [je({ id: 'JE-A', totalDebit: 280, description: 'CLAUDE.AI SUBSCRIPTION SAN FRANCISCO' })]
  )
  assert.equal(r.je?.id, 'JE-A')
  assert.equal(r.ambiguous, false)
})
test('vendor alias works in reverse: a "Claude" receipt matches an "Anthropic" JE', () => {
  const r = selectMatch(
    { vendor: 'Claude', total: 63, date: '2026-04-23' },
    [je({ id: 'JE-B', totalDebit: 63, description: 'ANTHROPIC SAN FRANCISCO' })]
  )
  assert.equal(r.je?.id, 'JE-B')
})

test('FX band absorbs Amex markup: $21 USD (BoC ~$28.77) matches a $30.56 CAD JE (~6%)', () => {
  const r = selectMatch(
    { vendor: 'Anthropic, PBC', total: 21, currency: 'USD', cadTotal: 28.77, date: '2026-06-23' },
    [je({ id: 'JE-FX', totalDebit: 30.56, description: 'ANTHROPIC SAN FRANCISCO' })]
  )
  assert.equal(r.je?.id, 'JE-FX')
})
test('split brand name: "Anthropic" receipt matches a "Bank: Anthro Pic Pbc" JE, not the OpenAI one', () => {
  // Bank descriptors split brand names ("Anthro Pic"); a space-stripped compare
  // recovers it, and the vendor token also disambiguates from a near-identical
  // OpenAI amount the same day (a same-day near-identical-amount collision).
  const r = selectMatch(
    { vendor: 'Anthropic, PBC', total: 21, currency: 'USD', cadTotal: 28.89, date: '2026-06-23' },
    [
      je({ id: 'JE-ANT', totalDebit: 30.56, description: 'Bank: Anthro Pic Pbc', memo: 'API credits top up' }),
      je({ id: 'JE-OAI', totalDebit: 30.52, description: 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO' }),
    ]
  )
  assert.equal(r.je?.id, 'JE-ANT')
})
test('FX band still bounded: a ~15% gap does NOT match', () => {
  const r = selectMatch(
    { vendor: 'Anthropic', total: 21, currency: 'USD', cadTotal: 26.0, date: '2026-06-23' },
    [je({ id: 'JE-FX', totalDebit: 30.56, description: 'ANTHROPIC SAN FRANCISCO' })]
  )
  assert.equal(r.je, null)
})

test('no match: amount outside tolerance returns clean miss (not ambiguous)', () => {
  const r = selectMatch(
    { vendor: 'Flodesk', total: 19, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 42, description: 'Flodesk subscription' })]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, false)
  assert.equal(r.candidates.length, 0)
})

test('amount within the 0.02 cent tolerance still matches', () => {
  const r = selectMatch(
    { vendor: 'Flodesk', total: 19.0, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 19.01, description: 'Flodesk subscription' })]
  )
  assert.equal(r.je?.id, 'JE-1')
  assert.equal(r.ambiguous, false)
})

test('ambiguous: two candidates share the amount AND the vendor token → never auto-attach', () => {
  const r = selectMatch(
    { vendor: 'Flodesk', total: 19, date: '2026-06-19' },
    [
      je({ id: 'JE-1', totalDebit: 19, description: 'Flodesk subscription' }),
      je({ id: 'JE-2', totalDebit: 19, description: 'Flodesk add-on' }),
    ]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, true)
  assert.equal(r.candidates.length, 2)
})

test('ambiguous: amount matches but no vendor token confirms it → park for review', () => {
  const r = selectMatch(
    { vendor: 'Flodesk', total: 19, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 19, description: 'Some unrelated charge' })]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, true)
  assert.equal(r.candidates.length, 1)
})

test('ambiguous: missing OCR vendor cannot confirm even a unique amount', () => {
  const r = selectMatch(
    { vendor: '', total: 19, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 19, description: 'Flodesk subscription' })]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, true)
})

test('vendor token match is case- and punctuation-insensitive (incl. memo)', () => {
  const r = selectMatch(
    { vendor: 'ZORVO Collective', total: 200, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 200, description: 'Incorporation fee', memo: '[amex:abc] zorvo collective mail' })]
  )
  assert.equal(r.je?.id, 'JE-1')
  assert.equal(r.ambiguous, false)
})

test('generic stopwords do not create a false vendor match', () => {
  // "Acme" is the distinctive token; "Services" is generic. The JE only shares
  // "services", so it must NOT be treated as a confident vendor match.
  const r = selectMatch(
    { vendor: 'Acme Services', total: 50, date: '2026-06-19' },
    [je({ id: 'JE-1', totalDebit: 50, description: 'Office services' })]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, true)
})

test('vendorTokens lowercases, drops short tokens and generic stopwords', () => {
  assert.deepEqual(vendorTokens('ZORVO Collective Inc.'), ['zorvo', 'collective'])
  assert.deepEqual(vendorTokens('Acme Services Ltd'), ['acme'])
  assert.deepEqual(vendorTokens(''), [])
  assert.deepEqual(vendorTokens(null), [])
})

// --- FX-aware matching: a USD receipt vs a CAD JE (Amex statement, converted) ---
// The receipt total is USD; gmailCapture pre-converts it to CAD (Bank of Canada
// rate) and passes cadTotal. Because Amex adds an FX markup over the BoC rate, the
// match uses a percentage band, not the to-the-cent band — but still requires a
// distinctive vendor token so a wide band can't cause a false attach.

test('FX: USD receipt matches a CAD JE within the percentage band + vendor token', () => {
  const r = selectMatch(
    { vendor: 'Flodesk Inc.', total: 38, currency: 'USD', cadTotal: 51.3, date: '2026-02-01' },
    [je({ id: 'JE-1', totalDebit: 51.46, description: 'FLODESK.COM (personal Amex)' })]
  )
  assert.equal(r.je?.id, 'JE-1')
  assert.equal(r.ambiguous, false)
})

test('FX: a CAD-converted amount outside the band is a clean miss', () => {
  const r = selectMatch(
    { vendor: 'Flodesk Inc.', total: 38, currency: 'USD', cadTotal: 51.3, date: '2026-02-01' },
    [je({ id: 'JE-1', totalDebit: 60.0, description: 'FLODESK.COM (personal Amex)' })]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, false)
})

test('FX: in-band amount but NO vendor token → park, never auto-attach on a wide band', () => {
  const r = selectMatch(
    { vendor: 'Flodesk Inc.', total: 38, currency: 'USD', cadTotal: 51.3, date: '2026-02-01' },
    [je({ id: 'JE-1', totalDebit: 51.46, description: 'Some unrelated charge' })]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, true)
})

test('FX: two in-band candidates sharing the vendor token → ambiguous', () => {
  const r = selectMatch(
    { vendor: 'Anthropic', total: 140, currency: 'USD', cadTotal: 189.0, date: '2026-03-01' },
    [
      je({ id: 'JE-1', totalDebit: 189.5, description: 'ANTHROPIC' }),
      je({ id: 'JE-2', totalDebit: 191.0, description: 'ANTHROPIC PBC' }),
    ]
  )
  assert.equal(r.je, null)
  assert.equal(r.ambiguous, true)
  assert.equal(r.candidates.length, 2)
})

test('CAD receipts are unaffected: the cent-tolerance band still applies', () => {
  // Same currency → no percentage band. 0.04 apart must NOT match.
  const r = selectMatch(
    { vendor: 'Flodesk', total: 51.46, currency: 'CAD', date: '2026-02-01' },
    [je({ id: 'JE-1', totalDebit: 51.5, description: 'Flodesk subscription' })]
  )
  assert.equal(r.je, null)
})
