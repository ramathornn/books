'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { loadStripe, Stripe as StripeClient } from '@stripe/stripe-js'
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Props {
  shareToken: string
  invoiceNumber: string
  currency: string
  amountDue: number
  dateIssued: string
  dateDue: string
  businessName: string
  publishableKey: string
}

export default function PublicPaymentWidget(props: Props) {
  const stripePromise = useMemo<Promise<StripeClient | null> | null>(() => {
    if (!props.publishableKey) return null
    return loadStripe(props.publishableKey)
  }, [props.publishableKey])

  if (!stripePromise) {
    return (
      <div className="rounded-lg bg-white shadow-md p-6 mb-6 text-sm text-red-700">
        Online payments are not configured on the server.
      </div>
    )
  }

  return (
    <Elements stripe={stripePromise}>
      <PaymentForm {...props} />
    </Elements>
  )
}

function PaymentForm({
  shareToken,
  currency,
  amountDue,
  dateIssued,
  dateDue,
  businessName,
}: Props) {
  const stripe = useStripe()
  const elements = useElements()
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'form' | 'confirming' | 'success'>('form')
  const [paidAmount, setPaidAmount] = useState<number | null>(null)
  const [remainingDue, setRemainingDue] = useState<number | null>(null)
  const [serverConfirmed, setServerConfirmed] = useState(false)

  async function pollForServerConfirmation(chargedAmount: number) {
    const start = Date.now()
    const timeoutMs = 30000
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch(`/api/public-invoice/${shareToken}/status`, {
          cache: 'no-store',
        })
        if (r.ok) {
          const data = (await r.json()) as {
            status: string
            amountPaid: number
            amountDue: number
          }
          if (data.status === 'paid' || data.amountDue < amountDue) {
            setRemainingDue(data.amountDue)
            setServerConfirmed(true)
            return
          }
        }
      } catch {
        // keep polling
      }
      await new Promise((res) => setTimeout(res, 1500))
    }
    // Timeout: still treat client-side success as success — webhook may be slow
    setRemainingDue(Math.max(0, amountDue - chargedAmount))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setError(null)
    setSubmitting(true)

    try {
      const res = await fetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareToken }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start payment')
      }
      const { clientSecret } = (await res.json()) as { clientSecret: string }

      const card = elements.getElement(CardElement)
      if (!card) throw new Error('Card field not ready')

      setPhase('confirming')

      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card },
      })

      if (result.error) {
        setError(result.error.message || 'Payment failed')
        setPhase('form')
      } else if (result.paymentIntent?.status === 'succeeded') {
        const charged = (result.paymentIntent.amount ?? 0) / 100
        setPaidAmount(charged || amountDue)
        setPhase('success')
        await pollForServerConfirmation(charged || amountDue)
        // Refresh after a short pause so the user sees the thank-you message
        setTimeout(() => router.refresh(), 3500)
      } else {
        setError('Payment did not complete. Please try again.')
        setPhase('form')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Payment failed'
      setError(msg)
      setPhase('form')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'success') {
    const fullyPaid = remainingDue !== null && remainingDue <= 0
    return (
      <div className="rounded-lg bg-white shadow-md p-8 mb-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#D4EDDA]">
          <svg
            className="h-8 w-8 text-[#155724]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div className="text-xl font-semibold text-[#001B40]">Thank you for your payment</div>
        <div className="mt-2 text-sm text-[#576981]">
          {paidAmount !== null && (
            <>
              We received{' '}
              <span className="font-semibold text-[#001B40]">
                {formatCurrency(paidAmount, currency, { includeCode: false })} {currency}
              </span>
              .{' '}
            </>
          )}
          {fullyPaid
            ? 'This invoice is now paid in full.'
            : serverConfirmed && remainingDue !== null
              ? `Remaining balance: ${formatCurrency(remainingDue, currency, { includeCode: false })} ${currency}.`
              : 'Updating your invoice…'}
        </div>
        <div className="mt-1 text-xs text-[#9AA5B5]">
          A receipt has been sent by email. This page will update in a moment.
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-white shadow-md p-6 mb-6">
      <div className="grid grid-cols-3 gap-6 pb-6 border-b border-gray-200">
        <div>
          <div className="text-[28px] font-bold text-[#001B40] leading-tight">
            {formatCurrency(amountDue, currency, { includeCode: false })}{' '}
            <span className="text-base font-medium text-[#576981]">{currency}</span>
          </div>
          <div className="inline-block mt-1 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
            Due on {formatDate(dateDue)}
          </div>
        </div>
        <div>
          <div className="text-sm text-[#0075DD] font-medium mb-1">Issued on</div>
          <div className="text-sm text-[#001B40]">{formatDate(dateIssued)}</div>
          <div className="text-sm text-[#0075DD] font-medium mt-3 mb-1">From</div>
          <div className="text-sm text-[#001B40]">{businessName}</div>
        </div>
        <div />
      </div>

      <form onSubmit={handleSubmit} className="mt-6">
        <div className="text-sm font-medium text-gray-900 mb-3">Pay by Credit Card</div>

        <div className="border border-gray-300 rounded-md px-3 py-3">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '15px',
                  color: '#111827',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  '::placeholder': { color: '#9CA3AF' },
                },
                invalid: { color: '#BF2600' },
              },
            }}
          />
        </div>

        {error && (
          <div className="mt-4 rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!stripe || submitting}
          className="mt-5 w-full bg-[#2FA84F] hover:bg-[#268f3e] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-md transition-colors"
        >
          {submitting
            ? 'Processing...'
            : `Pay ${formatCurrency(amountDue, currency, { includeCode: false })}`}
        </button>

        <div className="mt-3 text-[11px] text-center text-gray-400">
          Payments are securely processed by Stripe. Your card details never touch our servers.
        </div>
      </form>
    </div>
  )
}
