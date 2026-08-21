import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  EXPECTED_GAP,
  amountTier,
  classifyMissing,
  classifyOrphans,
  classifyDuplicates,
  type JeRow,
  type MissingAnchors,
  type StoredFileRow,
  type HashedFile,
} from '@/lib/receiptRecon'

/**
 * Pure source-document reconciliation engine. Three exception classes over a DB
 * snapshot (loader passes data in, so this unit-tests with fixtures, no prisma):
 *   MISSING   — posted expense JEs documented by NONE of three anchors
 *               (JE / linked bank_transaction / linked POSTED bill), ITC-tagged.
 *   ORPHAN    — StoredFile copies tied to no live transaction.
 *   DUPLICATE — StoredFiles sharing a content sha256.
 */

// ---- amountTier (CRA 2021-04-20 ITC thresholds) ----

test('amountTier: boundaries <100 / 100-499.99 / 500+', () => {
  assert.equal(amountTier(99.99), '<100')
  assert.equal(amountTier(100.0), '100-499.99')
  assert.equal(amountTier(499.99), '100-499.99')
  assert.equal(amountTier(500.0), '500+')
  assert.equal(amountTier(0), '<100')
})

// ---- classifyMissing (3 anchors) ----

const baseJe = (over: Partial<JeRow>): JeRow => ({
  id: 'je1',
  entryNumber: 'JE-0001',
  date: '2026-01-15',
  amount: 250,
  account: '6000 Advertising',
  accountNames: ['Advertising'],
  description: 'Meta Ads',
  itcBearing: true, // loader sets this from a 2315 GST/HST Receivable (ITC) line
  ...over,
})

const noAnchors = (): MissingAnchors => ({
  jeAttached: new Set<string>(),
  bankTxnAttached: new Set<string>(),
  billAttached: new Set<string>(),
})

test('classifyMissing: undocumented JE is flagged, tagged with tier + itc', () => {
  const out = classifyMissing([baseJe({})], noAnchors())
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'je1')
  assert.equal(out[0].amountTier, '100-499.99')
  assert.equal(out[0].itcBearing, true)
})

test('classifyMissing: carries itcBearing=false through (foreign no-GST charge)', () => {
  const out = classifyMissing([baseJe({ itcBearing: false, amount: 9.99 })], noAnchors())
  assert.equal(out.length, 1)
  assert.equal(out[0].itcBearing, false)
  assert.equal(out[0].amountTier, '<100')
})

test('classifyMissing: documented by JE attachment → excluded', () => {
  const a = noAnchors()
  a.jeAttached.add('je1')
  assert.equal(classifyMissing([baseJe({})], a).length, 0)
})

test('classifyMissing: documented by bank_transaction attachment only → excluded (current blind spot)', () => {
  const a = noAnchors()
  a.bankTxnAttached.add('je1')
  assert.equal(classifyMissing([baseJe({})], a).length, 0)
})

test('classifyMissing: documented by POSTED bill attachment only → excluded', () => {
  const a = noAnchors()
  a.billAttached.add('je1')
  assert.equal(classifyMissing([baseJe({})], a).length, 0)
})

test('classifyMissing: EXPECTED_GAP (fee/fx/depreciation/opening) → excluded', () => {
  const bankFee = baseJe({ id: 'j2', account: '6010 Bank Fees', accountNames: ['Bank Fees'], description: 'monthly fee' })
  const fx = baseJe({ id: 'j3', account: '7000 FX', accountNames: ['Foreign Exchange Gain/Loss'], description: 'revaluation' })
  const open = baseJe({ id: 'j4', account: '3000 Opening', accountNames: ['Opening Balance'], description: 'opening' })
  assert.equal(classifyMissing([bankFee, fx, open], noAnchors()).length, 0)
})

test('EXPECTED_GAP regex matches the expected legitimate-gap classes', () => {
  for (const s of ['Bank Fees', 'interest', 'FX revaluation', 'depreciation', 'opening balance']) {
    assert.ok(EXPECTED_GAP.test(s), `should match: ${s}`)
  }
  assert.equal(EXPECTED_GAP.test('Advertising'), false)
})

// ---- classifyOrphans ----

const sf = (over: Partial<StoredFileRow>): StoredFileRow => ({
  id: 'sf1',
  name: '2026-01-15_Vendor_10.00CAD.pdf',
  storagePath: 'receipts/2026-01/sf1.pdf',
  expenseId: null,
  folder: '2026-01',
  ...over,
})

test('classifyOrphans: null-expense, path in no Attachment, no live Expense → orphan', () => {
  const out = classifyOrphans([sf({})], new Set<string>(), new Set<string>())
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'sf1')
})

test('classifyOrphans: live expense link → NOT orphan', () => {
  const out = classifyOrphans([sf({ expenseId: 'e1' })], new Set<string>(), new Set(['e1']))
  assert.equal(out.length, 0)
})

test('classifyOrphans: dangling expenseId (deleted expense) → orphan', () => {
  const out = classifyOrphans([sf({ expenseId: 'gone' })], new Set<string>(), new Set(['e1']))
  assert.equal(out.length, 1)
})

test('classifyOrphans: storagePath referenced by an Attachment → NOT orphan (disjointness guard)', () => {
  const out = classifyOrphans([sf({})], new Set(['receipts/2026-01/sf1.pdf']), new Set<string>())
  assert.equal(out.length, 0)
})

// ---- classifyDuplicates ----

const hf = (over: Partial<HashedFile>): HashedFile => ({
  id: 'h1',
  name: 'a.pdf',
  storagePath: 'receipts/2026-01/h1.pdf',
  expenseId: null,
  sha256: 'AAAA',
  createdAt: '2026-01-15T00:00:00.000Z',
  ...over,
})

test('classifyDuplicates: same sha256, different names → one group, oldest canonical', () => {
  const groups = classifyDuplicates([
    hf({ id: 'h1', name: 'a.pdf', createdAt: '2026-01-10T00:00:00.000Z' }),
    hf({ id: 'h2', name: 'b.pdf', createdAt: '2026-01-20T00:00:00.000Z' }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].canonical.id, 'h1') // oldest kept
  assert.deepEqual(groups[0].duplicates.map((d) => d.id), ['h2'])
})

test('classifyDuplicates: expense-linked copy is preferred as canonical over an older orphan', () => {
  const groups = classifyDuplicates([
    hf({ id: 'old', expenseId: null, createdAt: '2026-01-10T00:00:00.000Z' }),
    hf({ id: 'linked', expenseId: 'e1', createdAt: '2026-01-20T00:00:00.000Z' }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].canonical.id, 'linked')
})

test('classifyDuplicates: same name but different sha256 → NOT a duplicate (hash beats name)', () => {
  const groups = classifyDuplicates([
    hf({ id: 'h1', name: 'same.pdf', sha256: 'AAAA' }),
    hf({ id: 'h2', name: 'same.pdf', sha256: 'BBBB' }),
  ])
  assert.equal(groups.length, 0)
})

test('classifyDuplicates: null/empty hash rows are not grouped (missing bytes reported elsewhere)', () => {
  const groups = classifyDuplicates([
    hf({ id: 'h1', sha256: '' }),
    hf({ id: 'h2', sha256: '' }),
  ])
  assert.equal(groups.length, 0)
})
