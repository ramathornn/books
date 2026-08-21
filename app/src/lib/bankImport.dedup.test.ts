import { test } from 'node:test'
import assert from 'node:assert/strict'

import { dedupePlaidImportTxns, type PlaidImportTxn } from '@/lib/bankImport'

/**
 * Plaid's `/transactions/sync` `added` array can carry the SAME transaction_id
 * more than once in a single page (observed: one repeated charge delivered 3x in one
 * batch). The importer dedups against already-committed rows, so a within-batch
 * repeat slips past and `createMany` inserts N identical rows. dedupePlaidImportTxns
 * collapses a batch to one row per plaid_transaction_id BEFORE insert.
 */

const mk = (id: string, over: Partial<PlaidImportTxn> = {}): PlaidImportTxn => ({
  plaidTransactionId: id,
  date: '2026-06-29',
  description: 'Anthro Pic Pbc',
  payee: 'Anthropic',
  amount: -74.25,
  ...over,
})

test('collapses a triplicated id to a single row', () => {
  const out = dedupePlaidImportTxns([mk('L5Zk'), mk('L5Zk'), mk('L5Zk')])
  assert.equal(out.length, 1)
  assert.equal(out[0].plaidTransactionId, 'L5Zk')
})

test('keeps distinct ids untouched and preserves order', () => {
  const out = dedupePlaidImportTxns([mk('a'), mk('b'), mk('c')])
  assert.deepEqual(out.map((t) => t.plaidTransactionId), ['a', 'b', 'c'])
})

test('last occurrence wins (Plaid may re-send an edited row)', () => {
  const out = dedupePlaidImportTxns([
    mk('x', { amount: -280 }),
    mk('x', { amount: -281 }),
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].amount, -281)
})

test('empty batch → empty', () => {
  assert.deepEqual(dedupePlaidImportTxns([]), [])
})
