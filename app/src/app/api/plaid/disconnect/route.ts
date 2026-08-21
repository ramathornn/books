import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { decryptSecret } from '@/lib/crypto'

// Unlink a bank account from Plaid. If it was the last account using that Plaid
// Item, remove the Item from Plaid entirely (stops billing + future syncs).
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const bankAccountId = String(body.bankAccountId || '')
  if (!bankAccountId) return Response.json({ error: 'bankAccountId required' }, { status: 400 })

  const ba = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
  if (!ba) return Response.json({ error: 'Bank account not found' }, { status: 404 })
  const itemDbId = ba.plaidItemId
  if (!itemDbId) return Response.json({ ok: true })

  await prisma.bankAccount.update({
    where: { id: bankAccountId },
    data: { plaidItemId: null, plaidAccountId: null, isConnected: false },
  })

  const remaining = await prisma.bankAccount.count({ where: { plaidItemId: itemDbId } })
  if (remaining === 0) {
    const item = await prisma.plaidItem.findUnique({ where: { id: itemDbId } })
    if (item && plaid) {
      try {
        await plaid.itemRemove({ access_token: decryptSecret(item.accessTokenEnc) })
      } catch (err) {
        console.error('[plaid disconnect] itemRemove failed', err)
      }
    }
    await prisma.plaidItem.delete({ where: { id: itemDbId } }).catch(() => {})
  }

  return Response.json({ ok: true })
}
