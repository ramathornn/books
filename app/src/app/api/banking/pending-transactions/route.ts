import { NextRequest } from 'next/server'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'

// GET /api/banking/pending-transactions — headless listing of bank transactions
// for an agent to triage or audit.
//
// Query params:
//   bank_account_id (string, OPTIONAL) — restrict to one account; omit to span all
//   status          (string, default "pending") — pending | posted | excluded | all
//   search          (string, optional) — case-insensitive contains over
//                                         description / payee / memo
//   limit           (default 100, clamped 1..500)
//   offset          (default 0, clamped >= 0)
//
// Does its own Bearer-token OR session auth (requireApiAuth); listed in
// src/proxy.ts PUBLIC_PATHS to bypass the session-cookie redirect.
//
// Despite the legacy name, it can return POSTED (categorized/matched) and
// EXCLUDED rows too — pass status=posted (e.g. with search="Mastercard") to find
// rows to reverse via /api/banking/uncategorize. Each row surfaces its match/JE
// linkage so the agent knows what a posted row is tied to.
export async function GET(request: NextRequest) {
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const { searchParams } = request.nextUrl

  const bankAccountId = (searchParams.get('bank_account_id') || '').trim()

  // status filter: default to the historical "pending" behaviour; "all" disables it.
  const statusParam = (searchParams.get('status') || 'pending').trim().toLowerCase()
  const VALID = new Set(['pending', 'posted', 'excluded', 'all'])
  if (!VALID.has(statusParam)) {
    return Response.json(
      { error: 'status must be one of: pending, posted, excluded, all' },
      { status: 400 }
    )
  }

  const search = (searchParams.get('search') || '').trim()

  const limitRaw = Number.parseInt(searchParams.get('limit') || '', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 100
  const offsetRaw = Number.parseInt(searchParams.get('offset') || '', 10)
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0

  // Validate the account only when one is supplied.
  if (bankAccountId) {
    const account = await prisma.bankAccount.findUnique({ where: { id: bankAccountId } })
    if (!account) {
      return Response.json({ error: 'Bank account not found' }, { status: 404 })
    }
  }

  const where = {
    ...(bankAccountId ? { bankAccountId } : {}),
    ...(statusParam !== 'all' ? { status: statusParam } : {}),
    ...(search
      ? {
          OR: [
            { description: { contains: search, mode: 'insensitive' as const } },
            { payee: { contains: search, mode: 'insensitive' as const } },
            { memo: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [total, rows] = await Promise.all([
    prisma.bankTransaction.count({ where }),
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ transactionDate: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: limit,
      include: { bankAccount: { include: { glAccount: true } } },
    }),
  ])

  const transactions = rows.map((tx) => ({
    id: tx.id,
    bank_account_id: tx.bankAccountId,
    account_name: tx.bankAccount.glAccount.accountName,
    date: tx.transactionDate.toISOString().slice(0, 10),
    description: tx.description,
    payee: tx.payee,
    amount: Number(tx.amount),
    currency: (tx.bankAccount.glAccount.currency || 'CAD').toUpperCase(),
    status: tx.status,
    suggestedCategoryGlAccountId: tx.categoryGlAccountId,
    // Match/JE linkage — for posted rows, shows what it's tied to so the agent
    // can decide what to uncategorize.
    journalEntryId: tx.journalEntryId,
    matchedInvoiceId: tx.matchedInvoiceId,
    matchedPaymentId: tx.matchedPaymentId,
    matchedExpenseId: tx.matchedExpenseId,
    transferPairId: tx.transferPairId,
    categoryGlAccountId: tx.categoryGlAccountId,
    raw_data: {
      memo: tx.memo,
      balanceAfter: tx.balanceAfter == null ? null : Number(tx.balanceAfter),
      plaidTransactionId: tx.plaidTransactionId,
    },
  }))

  return Response.json({
    transactions,
    total,
    has_more: offset + rows.length < total,
  })
}
