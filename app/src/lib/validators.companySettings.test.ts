import { test } from 'node:test'
import assert from 'node:assert/strict'

import { companySettingsSchema } from '@/lib/validators'

const ok = (body: unknown) => companySettingsSchema.safeParse(body).success

test('accepts real fiscal year-ends', () => {
  assert.ok(ok({ fiscalYearEndMonth: 10, fiscalYearEndDay: 31 })) // Oct 31
  assert.ok(ok({ fiscalYearEndMonth: 12, fiscalYearEndDay: 31 })) // calendar year
  assert.ok(ok({ fiscalYearEndMonth: 6, fiscalYearEndDay: 15 })) // non-month-end
  // Feb 29 is allowed on purpose — it clamps to the 28th in non-leap years.
  assert.ok(ok({ fiscalYearEndMonth: 2, fiscalYearEndDay: 29 }))
})

test('rejects impossible day/month combinations', () => {
  assert.equal(ok({ fiscalYearEndMonth: 4, fiscalYearEndDay: 31 }), false) // April has 30
  assert.equal(ok({ fiscalYearEndMonth: 2, fiscalYearEndDay: 30 }), false)
  assert.equal(ok({ fiscalYearEndMonth: 9, fiscalYearEndDay: 31 }), false) // September has 30
  assert.equal(ok({ fiscalYearEndMonth: 13, fiscalYearEndDay: 1 }), false)
  assert.equal(ok({ fiscalYearEndMonth: 0, fiscalYearEndDay: 1 }), false)
  assert.equal(ok({ fiscalYearEndMonth: 1, fiscalYearEndDay: 32 }), false)
  assert.equal(ok({ fiscalYearEndMonth: 1.5, fiscalYearEndDay: 1 }), false)
  assert.equal(ok({ fiscalYearEndMonth: 1, fiscalYearEndDay: 0 }), false)
})

test('rejects a half-specified year-end', () => {
  // Neither half means anything alone — accepting one would write a year-end the
  // user never chose (e.g. month=10 against a stored day=31 vs day=15).
  assert.equal(ok({ fiscalYearEndMonth: 10 }), false)
  assert.equal(ok({ fiscalYearEndDay: 31 }), false)
})

test('the year-end is optional — other fields still save without it', () => {
  assert.ok(ok({ name: 'Acme Inc.' }))
  assert.ok(ok({}))
})

test('the errored field is reported as fiscalYearEndDay', () => {
  const r = companySettingsSchema.safeParse({ fiscalYearEndMonth: 4, fiscalYearEndDay: 31 })
  assert.equal(r.success, false)
  if (!r.success) {
    assert.ok(r.error.flatten().fieldErrors.fiscalYearEndDay)
  }
})

test('the form’s nested fiscalYearEnd object is stripped, not rejected', () => {
  // BusinessProfileForm posts the whole form state, which still carries the
  // nested object alongside the flat pair. It must not cause a 400.
  const r = companySettingsSchema.safeParse({
    name: 'Acme Inc.',
    fiscalYearEnd: { month: 10, day: 31 },
    fiscalYearEndMonth: 10,
    fiscalYearEndDay: 31,
  })
  assert.ok(r.success)
  if (r.success) {
    assert.equal('fiscalYearEnd' in r.data, false)
    assert.equal(r.data.fiscalYearEndMonth, 10)
    assert.equal(r.data.fiscalYearEndDay, 31)
  }
})

test('existing string validation is unchanged', () => {
  assert.ok(ok({ albertaCorporateAccountNumber: '1234567890' }))
  assert.equal(ok({ albertaCorporateAccountNumber: '123' }), false)
  assert.ok(ok({ t2ProgramAccount: '123456789RC0001' }))
  assert.equal(ok({ t2ProgramAccount: 'nope' }), false)
  assert.ok(ok({ albertaCorporateAccountNumber: '' })) // empty clears
})
