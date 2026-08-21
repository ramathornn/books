import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { encryptSecret } from '@/lib/crypto'

// Connect a Stripe account as a READ-ONLY revenue source: validate the supplied
// restricted key actually works (a read call), then persist the connection with
// the key encrypted at rest and the GL account mapping the posting model will
// write to. Mirrors the Plaid exchange route.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const secretKey = String(body.secretKey || '').trim()
  if (!secretKey) return Response.json({ error: 'secretKey required' }, { status: 400 })

  const mapKeys = [
    'revenueAccountId',
    'feeAccountId',
    'clearingAccountId',
    'gstPayableAccountId',
    'payoutDestinationAccountId',
    'gstTaxCodeId',
    'zeroRatedTaxCodeId',
  ] as const
  const map: Record<string, string> = {}
  for (const k of mapKeys) {
    const v = String(body[k] || '').trim()
    if (!v) return Response.json({ error: `${k} required` }, { status: 400 })
    map[k] = v
  }

  // Validate the key (and that it has read access) before storing anything.
  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2026-03-25.dahlia' })
    await stripe.balance.retrieve()
  } catch {
    return Response.json({ error: 'Stripe key rejected (check the restricted key and its read access)' }, { status: 400 })
  }

  const connection = await prisma.stripeConnection.create({
    data: {
      displayName: String(body.displayName || 'Stripe').slice(0, 100),
      secretKeyEnc: encryptSecret(secretKey),
      revenueAccountId: map.revenueAccountId,
      feeAccountId: map.feeAccountId,
      clearingAccountId: map.clearingAccountId,
      gstPayableAccountId: map.gstPayableAccountId,
      payoutDestinationAccountId: map.payoutDestinationAccountId,
      gstTaxCodeId: map.gstTaxCodeId,
      zeroRatedTaxCodeId: map.zeroRatedTaxCodeId,
      status: 'active',
    },
    select: { id: true, displayName: true, accountId: true, status: true },
  })

  return Response.json({ connection })
}
