import Stripe from 'stripe'

const key = process.env.STRIPE_SECRET_KEY

export const stripe = key
  ? new Stripe(key, { apiVersion: '2026-03-25.dahlia' })
  : null

export const ALLOWED_CURRENCIES = ['CAD', 'USD', 'EUR'] as const
export type AllowedCurrency = (typeof ALLOWED_CURRENCIES)[number]

export function isAllowedCurrency(currency: string): currency is AllowedCurrency {
  return (ALLOWED_CURRENCIES as readonly string[]).includes(currency)
}

export function toStripeAmount(amount: number): number {
  return Math.round(amount * 100)
}
