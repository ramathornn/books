import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getEmailProvider } from './emailProvider'

// getEmailProvider() reads env at call time, so each case can set/clear vars.
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  try {
    fn()
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

test('defaults to mailgun when EMAIL_PROVIDER unset and key present', () => {
  withEnv(
    { EMAIL_PROVIDER: undefined, MAILGUN_API_KEY: 'key', RESEND_API_KEY: undefined },
    () => {
      assert.equal(getEmailProvider()?.name, 'mailgun')
    }
  )
})

test('returns null when the selected provider has no credentials', () => {
  withEnv({ EMAIL_PROVIDER: 'mailgun', MAILGUN_API_KEY: undefined }, () => {
    assert.equal(getEmailProvider(), null)
  })
})

test('selects resend when EMAIL_PROVIDER=resend and key present', () => {
  withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_key' }, () => {
    assert.equal(getEmailProvider()?.name, 'resend')
  })
})

test('resend without key returns null (does not silently fall back)', () => {
  withEnv({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: undefined }, () => {
    assert.equal(getEmailProvider(), null)
  })
})

test('unknown provider falls back to mailgun when key present', () => {
  withEnv({ EMAIL_PROVIDER: 'bogus', MAILGUN_API_KEY: 'key' }, () => {
    assert.equal(getEmailProvider()?.name, 'mailgun')
  })
})
