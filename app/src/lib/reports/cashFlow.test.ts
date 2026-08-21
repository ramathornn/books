import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  accountTypeOf,
  classifyCashFlowBucket,
  assembleCashFlowStatement,
  type CashFlowAccountLike,
  type CashFlowInputs,
  type CashFlowRow,
} from '@/lib/reports/cashFlow'

function acct(
  over: Partial<CashFlowAccountLike> & { id: string; accountClass: string }
): CashFlowAccountLike {
  return {
    accountNumber: over.id,
    accountName: over.id,
    accountSubclass: '',
    detailType: '',
    cashFlowSection: null,
    hasBankAccount: false,
    bankAccountType: null,
    ...over,
  }
}

function inputs(
  over: Partial<CashFlowInputs> & { accounts: CashFlowAccountLike[] }
): CashFlowInputs {
  return {
    startBalances: new Map(),
    endBalances: new Map(),
    netIncome: 0,
    closingEquityDeltas: new Map(),
    ...over,
  }
}

const rowFor = (rows: CashFlowRow[], id: string) => rows.find((r) => r.accountId === id)

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

test('cash boundary — all vocabularies', () => {
  assert.equal(classifyCashFlowBucket(acct({ id: 'a', accountClass: 'asset', accountSubclass: 'Bank' })), 'cash')
  assert.equal(
    classifyCashFlowBucket(acct({ id: 'b', accountClass: 'asset', accountSubclass: 'Bank', detailType: 'Chequing' })),
    'cash'
  )
  assert.equal(classifyCashFlowBucket(acct({ id: 'c', accountClass: 'asset', detailType: 'Bank' })), 'cash')
  assert.equal(
    classifyCashFlowBucket(acct({ id: 'd', accountClass: 'asset', hasBankAccount: true, bankAccountType: 'checking' })),
    'cash'
  )
})

test('credit card is not cash', () => {
  assert.equal(
    classifyCashFlowBucket(
      acct({ id: 'cc1', accountClass: 'liability', hasBankAccount: true, bankAccountType: 'credit_card', accountSubclass: 'Credit Card' })
    ),
    'operating'
  )
  assert.equal(
    classifyCashFlowBucket(acct({ id: 'cc2', accountClass: 'liability', accountSubclass: 'Credit Card' })),
    'operating'
  )
})

test('seed vocabulary', () => {
  assert.equal(classifyCashFlowBucket(acct({ id: '1', accountClass: 'asset', accountSubclass: 'Accounts Receivable' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '2', accountClass: 'asset', accountSubclass: 'Current Assets' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '3', accountClass: 'asset', accountSubclass: 'Property, Plant and Equipment' })), 'investing')
  assert.equal(classifyCashFlowBucket(acct({ id: '4', accountClass: 'liability', accountSubclass: 'Accounts Payable' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '5', accountClass: 'liability', accountSubclass: 'Other Current Liabilities' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '6', accountClass: 'liability', accountSubclass: 'Long-term Liabilities' })), 'financing')
  assert.equal(classifyCashFlowBucket(acct({ id: '7', accountClass: 'equity', accountSubclass: 'Equity' })), 'financing')
})

test('form vocabulary (canonical labels in subclass)', () => {
  assert.equal(classifyCashFlowBucket(acct({ id: '1', accountClass: 'asset', accountSubclass: 'Accounts receivable (A/R)' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '2', accountClass: 'asset', accountSubclass: 'Current assets' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '3', accountClass: 'asset', accountSubclass: 'Property, plant and equipment' })), 'investing')
  assert.equal(classifyCashFlowBucket(acct({ id: '4', accountClass: 'asset', accountSubclass: 'Long-term Assets' })), 'investing')
})

test('depreciation & amortization addback', () => {
  assert.equal(classifyCashFlowBucket(acct({ id: '1', accountClass: 'asset', detailType: 'Accumulated Depreciation' })), 'depreciationAddback')
  assert.equal(classifyCashFlowBucket(acct({ id: '2', accountClass: 'asset', detailType: 'Accumulated Amortization of Other Assets' })), 'depreciationAddback')
  assert.equal(classifyCashFlowBucket(acct({ id: '3', accountClass: 'asset', accountName: 'Accumulated Amortization — Equipment' })), 'depreciationAddback')
})

test('non-trade loan detail types', () => {
  assert.equal(classifyCashFlowBucket(acct({ id: '1', accountClass: 'asset', detailType: 'Loans to Shareholders' })), 'investing')
  assert.equal(classifyCashFlowBucket(acct({ id: '2', accountClass: 'liability', detailType: 'Line of Credit' })), 'financing')
  assert.equal(classifyCashFlowBucket(acct({ id: '3', accountClass: 'liability', detailType: 'Loan Payable' })), 'financing')
  assert.equal(classifyCashFlowBucket(acct({ id: '4', accountClass: 'liability', detailType: 'Short term borrowings from related parties' })), 'financing')
})

test('override — and cash wins over override', () => {
  assert.equal(
    classifyCashFlowBucket(acct({ id: '1', accountClass: 'asset', accountSubclass: 'Current Assets', cashFlowSection: 'investing' })),
    'investing'
  )
  assert.equal(
    classifyCashFlowBucket(
      acct({ id: '2', accountClass: 'asset', hasBankAccount: true, bankAccountType: 'checking', cashFlowSection: 'financing' })
    ),
    'cash'
  )
})

test('totality — every account maps somewhere', () => {
  assert.equal(classifyCashFlowBucket(acct({ id: '1', accountClass: 'liability' })), 'operating')
  assert.equal(classifyCashFlowBucket(acct({ id: '2', accountClass: 'equity' })), 'financing')
  assert.equal(classifyCashFlowBucket(acct({ id: '3', accountClass: 'income', accountSubclass: 'Revenue' })), 'operating')
})

test('accountTypeOf resolves both vocabularies', () => {
  assert.equal(accountTypeOf({ accountSubclass: 'Bank', detailType: '' }), 'Bank')
  assert.equal(accountTypeOf({ accountSubclass: '', detailType: 'Chequing' }), 'Bank')
  assert.equal(accountTypeOf({ accountSubclass: 'Accounts Receivable', detailType: '' }), 'Accounts receivable (A/R)')
  assert.equal(accountTypeOf({ accountSubclass: '', detailType: '' }), null)
})

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

test('9 — simple operating (AR build, net income)', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const ar = acct({ id: 'ar', accountClass: 'asset', accountSubclass: 'Accounts Receivable' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash, ar],
      startBalances: new Map([['cash', 0], ['ar', 0]]),
      endBalances: new Map([['cash', 60], ['ar', 40]]),
      netIncome: 100,
    })
  )
  assert.equal(s.operatingRows.length, 1)
  assert.equal(rowFor(s.operatingRows, 'ar')!.amount, -40)
  assert.equal(s.operatingTotal, 60)
  assert.equal(s.netCashChange, 60)
  assert.equal(s.cashAtStart, 0)
  assert.equal(s.cashAtEnd, 60)
  assert.equal(s.discrepancy, 0)
})

test('10 — both directions (AR collection, AP increase)', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const ar = acct({ id: 'ar', accountClass: 'asset', accountSubclass: 'Accounts Receivable' })
  const ap = acct({ id: 'ap', accountClass: 'liability', accountSubclass: 'Accounts Payable' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash, ar, ap],
      startBalances: new Map([['cash', 0], ['ar', 25], ['ap', 0]]),
      endBalances: new Map([['cash', 55], ['ar', 0], ['ap', 30]]),
      netIncome: 0,
    })
  )
  assert.equal(rowFor(s.operatingRows, 'ar')!.amount, 25)
  assert.equal(rowFor(s.operatingRows, 'ap')!.amount, 30)
  assert.equal(s.operatingTotal, 55)
  assert.equal(s.discrepancy, 0)
})

test('11 — depreciation addback + capex', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const accdep = acct({ id: 'accdep', accountClass: 'asset', detailType: 'Accumulated Depreciation' })
  const ppe = acct({ id: 'ppe', accountClass: 'asset', accountSubclass: 'Property, Plant and Equipment' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash, accdep, ppe],
      startBalances: new Map([['cash', 200], ['accdep', 0], ['ppe', 0]]),
      endBalances: new Map([['cash', 0], ['accdep', -50], ['ppe', 200]]),
      netIncome: -50,
    })
  )
  assert.equal(rowFor(s.depreciationRows, 'accdep')!.amount, 50)
  assert.equal(rowFor(s.investingRows, 'ppe')!.amount, -200)
  assert.equal(s.operatingTotal, 0)
  assert.equal(s.netCashChange, -200)
  assert.equal(s.discrepancy, 0)
})

test('12 — dividend declared (no close)', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const re = acct({ id: 're', accountClass: 'equity', accountSubclass: 'Equity', detailType: 'Retained Earnings' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash, re],
      startBalances: new Map([['cash', 30], ['re', 100]]),
      endBalances: new Map([['cash', 0], ['re', 70]]),
      netIncome: 0,
    })
  )
  assert.equal(rowFor(s.financingRows, 're')!.amount, -30)
  assert.equal(s.financingTotal, -30)
  assert.equal(s.discrepancy, 0)
})

test('13 — shareholder loan draw (financing inflow)', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const loan = acct({ id: 'loan', accountClass: 'liability', accountSubclass: 'Long-term Liabilities' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash, loan],
      startBalances: new Map([['cash', 0], ['loan', 0]]),
      endBalances: new Map([['cash', 500], ['loan', 500]]),
      netIncome: 0,
    })
  )
  assert.equal(rowFor(s.financingRows, 'loan')!.amount, 500)
  assert.equal(s.financingTotal, 500)
  assert.equal(s.discrepancy, 0)
})

test('14 — pure bank↔bank transfer produces no rows', () => {
  const c1 = acct({ id: 'c1', accountClass: 'asset', accountSubclass: 'Bank' })
  const c2 = acct({ id: 'c2', accountClass: 'asset', accountSubclass: 'Bank' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [c1, c2],
      startBalances: new Map([['c1', 0], ['c2', 100]]),
      endBalances: new Map([['c1', 100], ['c2', 0]]),
      netIncome: 0,
    })
  )
  assert.equal(s.operatingRows.length, 0)
  assert.equal(s.investingRows.length, 0)
  assert.equal(s.financingRows.length, 0)
  assert.equal(s.depreciationRows.length, 0)
  assert.equal(s.netCashChange, 0)
  assert.equal(s.cashAtEnd - s.cashAtStart, 0)
  assert.equal(s.discrepancy, 0)
})

test('15 — period spanning a fiscal-year close', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const re = acct({ id: 're', accountClass: 'equity', accountSubclass: 'Equity', detailType: 'Retained Earnings' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash, re],
      startBalances: new Map([['cash', 0], ['re', 0]]),
      endBalances: new Map([['cash', 80], ['re', 80]]),
      netIncome: 100, // closing-excluded
      closingEquityDeltas: new Map([['re', 100]]),
    })
  )
  assert.equal(rowFor(s.financingRows, 're')!.amount, -20) // the dividend, net of the closing shuffle
  assert.equal(s.netCashChange, 80)
  assert.equal(s.discrepancy, 0)
})

test('16 — sub-cent delta suppressed, totals consistent', () => {
  const ar = acct({ id: 'ar', accountClass: 'asset', accountSubclass: 'Accounts Receivable' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [ar],
      startBalances: new Map([['ar', 0]]),
      endBalances: new Map([['ar', 0.004]]),
      netIncome: 0,
    })
  )
  assert.equal(s.operatingRows.length, 0)
  assert.equal(s.operatingTotal, 0)
  assert.equal(s.netCashChange, 0)
  assert.equal(s.discrepancy, 0)
})

test('17 — tie-out leak is reported, not thrown', () => {
  const cash = acct({ id: 'cash', accountClass: 'asset', accountSubclass: 'Bank' })
  const s = assembleCashFlowStatement(
    inputs({
      accounts: [cash],
      startBalances: new Map([['cash', 0]]),
      endBalances: new Map([['cash', 100]]),
      netIncome: 90, // non-cash sources explain only 90 of the 100 cash move
    })
  )
  assert.equal(s.netCashChange, 90)
  assert.equal(s.discrepancy, 10)
})
