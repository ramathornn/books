import { test } from 'node:test'
import assert from 'node:assert/strict'

import { computeT5Boxes } from '@/lib/tax/compute/t5'
import { computeT4ABoxes } from '@/lib/tax/compute/t4a'
import { computeGst34Lines } from '@/lib/tax/compute/gst34'
import { computeCca } from '@/lib/tax/compute/cca'
import { round2, roundDollar } from '@/lib/tax/round'
import { isValidSin, maskSin, sinLast3 } from '@/lib/tax/sin'
import { effectiveSlips, type EffectiveSlipRow } from '@/lib/tax/effectiveSlips'

/**
 * PINNED test. A 2025 non-eligible dividend of $100,000 MUST produce
 * Box10=100000.00, Box11=115000.00, Box12=10384.62. This guards the
 * non-eligible gross-up (1.15) and DTC (9/13 of the gross-up) formulas.
 */
test('T5 non-eligible $100,000 (2025) ⇒ box10/11/12 pinned values', () => {
  const boxes = computeT5Boxes({ taxYear: 2025, actualDividend: 100000, kind: 'nonEligible' })
  assert.equal(boxes.box10, 100000.0)
  assert.equal(boxes.box11, 115000.0)
  assert.equal(boxes.box12, 10384.62)
})

test('T5 Box 12 derivation cross-checks (9/13 of gross-up = 10384.62)', () => {
  // (100000 × 0.15) × 9/13 = 15000 × 9/13 = 10384.6153… → 10384.62
  assert.equal(round2((100000 * 0.15 * 9) / 13), 10384.62)
  // 115000 × 0.090301 = 10384.615 → 10384.62
  assert.equal(round2(115000 * 0.090301), 10384.62)
})

test('T5 eligible path grosses up by 1.38 and credits 0.150198', () => {
  const boxes = computeT5Boxes({ taxYear: 2025, actualDividend: 100000, kind: 'eligible' })
  assert.equal(boxes.box24, 100000.0)
  assert.equal(boxes.box25, 138000.0)
  assert.equal(boxes.box26, round2(138000 * 0.150198)) // 20727.32
})

test('round2 is half-up and binary-float safe', () => {
  assert.equal(round2(1.005), 1.01)
  assert.equal(round2(2.675), 2.68)
  assert.equal(round2(164450 * 0.090301), 14850.0)
  assert.equal(round2(-1.005), -1.01)
  assert.equal(roundDollar(164449.5), 164450)
})

test('T4A Box 048 rounds the fees total ($12,000)', () => {
  assert.deepEqual(computeT4ABoxes(12000), { box048: 12000.0 })
})

test('GST34 lines fold/derive correctly; negative 109 is a refund', () => {
  const lines = computeGst34Lines({ revenue: 50000, collected: 2500, itcs: 3000 })
  assert.equal(lines.line101, 50000.0)
  assert.equal(lines.line105, 2500.0)
  assert.equal(lines.line108, 3000.0)
  assert.equal(lines.line109, -500.0) // refund
})

test('CCA declining-balance + half-year rule (class 10, 30%)', () => {
  // opening 0, additions 10000, half-year base = 10000 - 5000 = 5000, claim = 1500
  const r = computeCca({
    taxYear: 2025,
    classNumber: '10',
    rate: 0.3,
    openingUcc: 0,
    additions: 10000,
    dispositions: 0,
  })
  assert.equal(r.halfYearAdjustment, 5000.0)
  assert.equal(r.ccaBase, 5000.0)
  assert.equal(r.ccaClaimed, 1500.0)
  assert.equal(r.closingUcc, 8500.0)
})

test('SIN: Luhn validation + masking', () => {
  assert.equal(isValidSin('046454286'), true) // valid test SIN (Luhn-ok)
  assert.equal(isValidSin('046454285'), false)
  assert.equal(sinLast3('046 454 286'), '286')
  assert.equal(maskSin('046454286'), '•••-••-286')
})

test('effectiveSlips keeps latest amendment per slipNumber, drops cancelled', () => {
  const mk = (o: Partial<EffectiveSlipRow>): EffectiveSlipRow => ({
    id: o.id!, type: 'T5', taxYear: 2025, status: o.status ?? 'issued',
    slipNumber: o.slipNumber ?? null, amendmentSeq: o.amendmentSeq ?? 0,
    isCancelled: o.isCancelled ?? false, boxes: {}, boxesOverride: null,
    partyId: 'p', recipientNameSnapshot: 'X',
  })
  const rows = [
    mk({ id: 'a0', slipNumber: '001', amendmentSeq: 0, status: 'amended' }),
    mk({ id: 'a1', slipNumber: '001', amendmentSeq: 1, status: 'issued' }),
    mk({ id: 'b0', slipNumber: '002', amendmentSeq: 0 }),
    mk({ id: 'c0', slipNumber: '003', amendmentSeq: 0, isCancelled: true }),
  ]
  const eff = effectiveSlips(rows)
  const ids = eff.map((r) => r.id).sort()
  assert.deepEqual(ids, ['a1', 'b0'])
})
