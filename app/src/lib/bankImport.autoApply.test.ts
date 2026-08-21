import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planAutoApply } from './bankImport'
import type { BankRuleLite } from './bankRules'

// Build a complete rule; tests override only the fields the gate reads.
function rule(over: Partial<BankRuleLite>): BankRuleLite {
  return {
    id: 'r1',
    name: 'Rule',
    priority: 0,
    moneyDirection: 'both',
    accountScope: 'all',
    accountIds: [],
    conditionLogic: 'all',
    conditions: [],
    thenTransactionType: 'expense',
    categoryGlAccountId: 'gl-1',
    categoryId: null,
    vendorId: null,
    payee: '',
    taxCodeId: null,
    memo: '',
    memoAppend: '',
    splits: null,
    autoAdd: true,
    isActive: true,
    ...over,
  }
}

test('suggest-only rule (autoAdd=false) is skipped', () => {
  assert.deepEqual(planAutoApply(rule({ autoAdd: false })), { kind: 'skip', reason: 'rule is suggest-only' })
})

test('autoAdd exclude rule excludes the transaction', () => {
  assert.deepEqual(planAutoApply(rule({ thenTransactionType: 'exclude' })), { kind: 'exclude' })
})

for (const type of ['expense', 'income', 'transfer']) {
  test(`autoAdd ${type} rule with a category categorizes`, () => {
    assert.deepEqual(planAutoApply(rule({ thenTransactionType: type, categoryGlAccountId: 'gl-9' })), {
      kind: 'categorize',
      categoryGlAccountId: 'gl-9',
    })
  })
}

test('autoAdd rule without a category is skipped (cannot post)', () => {
  assert.deepEqual(planAutoApply(rule({ categoryGlAccountId: null })), {
    kind: 'skip',
    reason: 'no category to post to',
  })
})

// Priority precedence (a low-priority autoAdd rule not stealing a higher-priority
// suggest-only match) is enforced upstream by findBestRule choosing the single
// winner; planAutoApply only ever sees that winner.
