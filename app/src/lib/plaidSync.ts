import prisma from '@/lib/prisma'
import { plaid } from '@/lib/plaid'
import { decryptSecret } from '@/lib/crypto'
import { importPlaidTransactions, type PlaidImportTxn } from '@/lib/bankImport'

export interface ItemSyncResult {
  itemDbId: string
  accountsSynced: number
  inserted: number
  updated: number
  removed: number
}

/**
 * Pull new transactions for one Plaid Item and upsert them into the mapped bank
 * accounts, keyed by Plaid transaction_id (the canonical pattern):
 *  - added/modified (settled only) -> upsert; Plaid edits update the right row
 *  - removed -> delete the matching still-pending row
 * Pending entries aren't final, so we wait for them to post. Plaid's amount sign
 * is the opposite of ours, so amounts are negated. The /transactions/sync cursor
 * is stored on the item: the first call backfills history, later calls are
 * incremental. The sync response also carries live balances, which we refresh.
 */
export async function syncPlaidItem(itemDbId: string): Promise<ItemSyncResult> {
  if (!plaid) throw new Error('Plaid not configured')

  const item = await prisma.plaidItem.findUnique({
    where: { id: itemDbId },
    include: { bankAccounts: true },
  })
  if (!item) throw new Error('Plaid item not found')

  const accessToken = decryptSecret(item.accessTokenEnc)

  // Map Plaid account_id -> our mapped (non-archived) bank account.
  const byPlaidAccount = new Map(
    item.bankAccounts
      .filter((b) => b.plaidAccountId && !b.isArchived)
      .map((b) => [b.plaidAccountId as string, b])
  )

  try {
    const originalCursor = item.cursor || undefined
    const added: Array<{ accountId: string; txn: PlaidImportTxn }> = []
    let removedIds: string[] = []
    let accountsSnapshot: Awaited<ReturnType<typeof plaid.transactionsSync>>['data']['accounts'] = []
    let finalCursor = originalCursor

    // Paginate until has_more=false. Per Plaid: if a mutation happens during
    // pagination, discard partial results and restart from the original cursor.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      added.length = 0
      removedIds = []
      let cursor = originalCursor
      let hasMore = true
      let guard = 0
      try {
        while (hasMore && guard < 50) {
          guard += 1
          const res = await plaid.transactionsSync({
            access_token: accessToken,
            cursor,
            count: 500,
          })
          accountsSnapshot = res.data.accounts
          for (const t of [...res.data.added, ...res.data.modified]) {
            if (t.pending) continue
            added.push({
              accountId: t.account_id,
              txn: {
                plaidTransactionId: t.transaction_id,
                date: t.date, // already YYYY-MM-DD
                description: (t.merchant_name || t.name || '').slice(0, 200),
                payee: (t.merchant_name || '').slice(0, 120),
                amount: -(t.amount ?? 0), // Plaid: + = money out; app: - = money out
              },
            })
          }
          for (const r of res.data.removed) {
            if (r.transaction_id) removedIds.push(r.transaction_id)
          }
          hasMore = res.data.has_more
          cursor = res.data.next_cursor
        }
        finalCursor = cursor
        break
      } catch (e) {
        const ec = (e as { response?: { data?: { error_code?: string } } })?.response?.data
          ?.error_code
        if (ec === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < 2) continue
        throw e
      }
    }

    // Refresh the live bank balance for each mapped account.
    const now = new Date()
    for (const pa of accountsSnapshot) {
      const bank = byPlaidAccount.get(pa.account_id)
      if (!bank) continue
      await prisma.bankAccount.update({
        where: { id: bank.id },
        data: {
          plaidCurrentBalance: pa.balances.current ?? null,
          plaidAvailableBalance: pa.balances.available ?? null,
          plaidBalanceAt: now,
        },
      })
    }

    // Group added/modified by bank account, applying each account's sync-from cutoff.
    const byBank = new Map<string, PlaidImportTxn[]>()
    for (const { accountId, txn } of added) {
      const bank = byPlaidAccount.get(accountId)
      if (!bank) continue
      if (bank.plaidSyncFrom && txn.date < bank.plaidSyncFrom.toISOString().slice(0, 10)) continue
      const arr = byBank.get(bank.id) || []
      arr.push(txn)
      byBank.set(bank.id, arr)
    }

    let inserted = 0
    let updated = 0
    for (const [bankId, txns] of byBank) {
      const r = await importPlaidTransactions(bankId, txns)
      inserted += r.inserted
      updated += r.updated
    }

    // Removed: delete the still-pending rows (never touch already-posted ones).
    let removed = 0
    if (removedIds.length) {
      const del = await prisma.bankTransaction.deleteMany({
        where: { plaidTransactionId: { in: removedIds }, status: 'pending' },
      })
      removed = del.count
    }

    // Advance the cursor even past filtered-out rows so we never refetch them.
    await prisma.plaidItem.update({
      where: { id: item.id },
      data: { cursor: finalCursor, status: 'active', lastError: null, lastSyncAt: new Date() },
    })

    return { itemDbId: item.id, accountsSynced: byBank.size, inserted, updated, removed }
  } catch (err) {
    const code =
      (err as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code ||
      (err instanceof Error ? err.message : 'sync failed')
    await prisma.plaidItem.update({
      where: { id: item.id },
      data: {
        status: code === 'ITEM_LOGIN_REQUIRED' ? 'login_required' : 'error',
        lastError: String(code).slice(0, 300),
      },
    })
    throw err
  }
}
