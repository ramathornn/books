import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { categorizeBankTransaction } from '@/lib/categorizeBankTransaction'
import { learnVendorAlias } from '@/lib/vendorResolve'

/**
 * Bulk categorize: apply the SAME categorization to each of the given pending
 * bank transactions. Each transaction posts its own balanced journal entry via
 * the shared `categorizeBankTransaction` helper (identical logic to the
 * single-tx route). Already-posted / excluded / period-locked transactions are
 * skipped and reported per-id; no partial failure aborts the rest.
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const ids: string[] = Array.isArray(body.ids) ? body.ids.map((x: unknown) => String(x)) : []
  const categoryGlAccountId = String(body.categoryGlAccountId || '')

  if (ids.length === 0) return Response.json({ error: 'ids required' }, { status: 400 })
  if (!categoryGlAccountId) return Response.json({ error: 'categoryGlAccountId required' }, { status: 400 })

  const hasTaxCodeKey = 'taxCodeId' in body
  const taxCodeId = body.taxCodeId
  const vendorId = body.vendorId || null

  const results: Array<{ id: string; ok: boolean; journalEntryId?: string; error?: string }> = []

  // When a vendor is applied, learn each txn's own stored descriptors as aliases.
  // Load the stored payee/description up front (never trust an edited value).
  const stored = vendorId
    ? new Map(
        (
          await prisma.bankTransaction.findMany({
            where: { id: { in: ids } },
            select: { id: true, payee: true, description: true },
          })
        ).map((t) => [t.id, t])
      )
    : new Map<string, { id: string; payee: string; description: string }>()

  // Sequential (not Promise.all): entry-number allocation + balance updates are
  // safest one-at-a-time, and a few hundred rows is fine. Each tx is independent.
  for (const id of ids) {
    const result = await categorizeBankTransaction(id, {
      categoryGlAccountId,
      taxCodeId,
      hasTaxCodeKey,
      vendorId,
    })
    if (result.ok) {
      results.push({ id, ok: true, journalEntryId: result.journalEntryId })
      const s = stored.get(id)
      if (vendorId && s) {
        await learnVendorAlias(s.payee, vendorId, 'confirm')
        await learnVendorAlias(s.description, vendorId, 'confirm')
      }
    } else {
      results.push({ id, ok: false, error: result.error })
    }
  }

  const succeeded = results.filter((r) => r.ok).length
  const failed = results.length - succeeded

  return Response.json({ ok: true, succeeded, failed, results })
}
