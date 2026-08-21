import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { syncPlaidItem } from '@/lib/plaidSync'

// Manual "Sync now" — sync the Plaid Item behind a given bank account (or a
// given itemId). Syncing is per-Item, so it pulls every account in that
// connection and routes each transaction to its mapped bank account.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!plaid) return Response.json({ error: 'Plaid not configured' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  let itemId = String(body.itemId || '')
  const bankAccountId = String(body.bankAccountId || '')

  if (!itemId && bankAccountId) {
    const ba = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
      select: { plaidItemId: true },
    })
    itemId = ba?.plaidItemId || ''
  }
  if (!itemId) {
    return Response.json({ error: 'This account is not connected to Plaid.' }, { status: 400 })
  }

  try {
    const result = await syncPlaidItem(itemId)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const detail =
      (err as { response?: { data?: unknown } })?.response?.data ||
      (err instanceof Error ? err.message : 'sync failed')
    console.error('[plaid sync]', detail)
    return Response.json({ error: 'Sync failed', detail }, { status: 502 })
  }
}
