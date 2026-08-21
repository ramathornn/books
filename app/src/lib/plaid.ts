import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid'

// Mirrors src/lib/stripe.ts: an env-driven singleton that is `null` when not
// configured, so routes can fail closed with a clear "not configured" error.
const clientId = process.env.PLAID_CLIENT_ID
const secret = process.env.PLAID_SECRET
const env = (process.env.PLAID_ENV || 'production').toLowerCase()

const basePath = env === 'sandbox' ? PlaidEnvironments.sandbox : PlaidEnvironments.production

export const PLAID_ENV = env

export const plaid =
  clientId && secret
    ? new PlaidApi(
        new Configuration({
          basePath,
          baseOptions: {
            headers: {
              'PLAID-CLIENT-ID': clientId,
              'PLAID-SECRET': secret,
            },
          },
        })
      )
    : null
