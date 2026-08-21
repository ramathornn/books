import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { syncPlaidItem } from '@/lib/plaidSync'

interface Mapping {
  bankAccountId: string
  plaidAccountId: string
  syncFrom?: string // YYYY-MM-DD
}

// Map one or more of a Plaid Item's accounts to existing bank accounts, set the
// per-account sync-from date, then run the first sync.
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const itemId = String(body.itemId || '')
  const mappings: Mapping[] = Array.isArray(body.mappings) ? body.mappings : []
  if (!itemId || mappings.length === 0) {
    return Response.json({ error: 'itemId and mappings required' }, { status: 400 })
  }

  const item = await prisma.plaidItem.findUnique({ where: { id: itemId } })
  if (!item) return Response.json({ error: 'Plaid item not found' }, { status: 404 })

  for (const m of mappings) {
    const bankAccountId = String(m.bankAccountId || '')
    const plaidAccountId = String(m.plaidAccountId || '')
    if (!bankAccountId || !plaidAccountId) continue
    const syncFrom =
      m.syncFrom && /^\d{4}-\d{2}-\d{2}$/.test(m.syncFrom) ? new Date(m.syncFrom) : null
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: {
        plaidItemId: itemId,
        plaidAccountId,
        plaidSyncFrom: syncFrom,
        isConnected: true,
      },
    })
  }

  // Initial pull. If it fails, the mappings are still saved — the user can
  // retry from the "Sync now" button (the item's status/lastError is recorded).
  let sync = null
  let syncError: string | null = null
  try {
    sync = await syncPlaidItem(itemId)
  } catch (err) {
    syncError = err instanceof Error ? err.message : 'sync failed'
  }

  return Response.json({ ok: true, sync, syncError })
}
