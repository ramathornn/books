import crypto from 'node:crypto'
import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { findBestRule, type BankRuleLite, type BankTxLite } from '@/lib/bankRules'
import { getPeriodLock } from '@/lib/periodLock'
import { categorizeBankTransaction } from '@/lib/categorizeBankTransaction'
import { loadVendorIndex, suggestVendorForTx } from '@/lib/vendorResolve'

/** Load active bank rules in the lightweight shape the matcher expects. */
export async function loadActiveRules(): Promise<BankRuleLite[]> {
  const activeRules = await prisma.bankRule.findMany({ where: { isActive: true } })
  return activeRules.map((r) => ({
    id: r.id,
    name: r.name,
    priority: r.priority,
    moneyDirection: r.moneyDirection,
    accountScope: r.accountScope,
    accountIds: r.accountIds,
    conditionLogic: r.conditionLogic,
    conditions: r.conditions,
    pattern: r.pattern,
    matchType: r.matchType,
    thenTransactionType: r.thenTransactionType,
    categoryGlAccountId: r.categoryGlAccountId,
    categoryId: r.categoryId,
    vendorId: r.vendorId,
    payee: r.payee,
    taxCodeId: r.taxCodeId,
    memo: r.memo,
    memoAppend: r.memoAppend,
    splits: r.splits,
    autoAdd: r.autoAdd,
    isActive: r.isActive,
  }))
}

// ---- autoAdd: auto-post a matched rule ----

export type AutoApplyPlan =
  | { kind: 'skip'; reason: string }
  | { kind: 'exclude' }
  | { kind: 'categorize'; categoryGlAccountId: string }

/**
 * Decide what an auto-applied rule should do to a freshly-imported pending
 * transaction. Pure (no DB) so the gate is unit-tested in isolation.
 *
 * Only acts when the rule is flagged `autoAdd`; otherwise the transaction stays
 * pending for review. `findBestRule` already returns the single highest-priority
 * matching rule, so gating on *that* winner's flag means a low-priority autoAdd
 * rule can't steal a transaction a higher-priority suggest-only rule owns.
 */
export function planAutoApply(rule: BankRuleLite): AutoApplyPlan {
  if (!rule.autoAdd) return { kind: 'skip', reason: 'rule is suggest-only' }
  if (rule.thenTransactionType === 'exclude') return { kind: 'exclude' }
  if (!rule.categoryGlAccountId) return { kind: 'skip', reason: 'no category to post to' }
  return { kind: 'categorize', categoryGlAccountId: rule.categoryGlAccountId }
}

/**
 * Execute the auto-apply plan for one pending transaction: exclude it, or post
 * its categorized journal entry via the same path the manual "add" button uses.
 * Best-effort — a posting failure (period lock, unbalanced, …) leaves the row
 * pending for manual review rather than throwing.
 */
async function autoApplyRule(txId: string, rule: BankRuleLite): Promise<void> {
  const plan = planAutoApply(rule)
  if (plan.kind === 'skip') return
  if (plan.kind === 'exclude') {
    await prisma.bankTransaction.update({ where: { id: txId }, data: { status: 'excluded' } })
    return
  }
  await categorizeBankTransaction(txId, {
    categoryGlAccountId: plan.categoryGlAccountId,
    taxCodeId: rule.taxCodeId ?? null,
    hasTaxCodeKey: rule.taxCodeId != null,
    vendorId: rule.vendorId ?? null,
    memo: rule.memo ?? undefined,
    payee: rule.payee ?? undefined,
  })
}

/**
 * After import commits, auto-post the transactions whose winning rule is
 * `autoAdd`. Re-fetches the freshly-created pending rows (createMany returns no
 * ids) and applies each. Idempotent: only pending rows are touched, so a
 * re-sync that re-presents an already-posted transaction is a no-op.
 */
async function runAutoAdd(where: Prisma.BankTransactionWhereInput, rules: BankRuleLite[]): Promise<void> {
  const autoAddRuleIds = rules.filter((r) => r.autoAdd).map((r) => r.id)
  if (autoAddRuleIds.length === 0) return
  const ruleById = new Map(rules.map((r) => [r.id, r]))
  const created = await prisma.bankTransaction.findMany({
    where: { ...where, status: 'pending', bankImportRuleId: { in: autoAddRuleIds } },
    select: { id: true, bankImportRuleId: true },
  })
  for (const c of created) {
    const rule = c.bankImportRuleId ? ruleById.get(c.bankImportRuleId) : undefined
    if (rule) await autoApplyRule(c.id, rule)
  }
}

// One normalized bank transaction to import. Amount uses the APP convention:
// negative = money out, positive = money in. (CSV import and Plaid sync both
// normalize to this before calling importBankTransactions — Plaid's native sign
// is the opposite, so the Plaid sync flips it.)
export interface ImportRow {
  date: string // YYYY-MM-DD
  description: string
  amount: number
  balanceAfter?: number | null
  payee?: string // optional pre-filled payee (e.g. Plaid merchant_name)
}

export interface ImportResult {
  rowsTotal: number
  rowsToImport: number
  rowsInserted: number
  rowsDuplicate: number
  rowsInvalid: number
  // Rows dropped because their date is on/before the locked-period boundary.
  rowsSkippedLocked: number
  // The lock boundary applied (ISO YYYY-MM-DD), or null if the books aren't locked.
  lockedThrough: string | null
  importBatchId: string
}

// Base fingerprint of a transaction (account + date + amount + description).
function dedupeBase(bankAccountId: string, date: string, amount: number, description: string): string {
  return `${bankAccountId}|${date}|${amount.toFixed(2)}|${description.trim().toLowerCase().slice(0, 100)}`
}

// Per-occurrence hash. Genuinely-identical transactions on the same day (e.g.
// two identical coffees) get occurrence 0, 1, 2… so they aren't collapsed
// within a single import — while a later re-import of an overlapping statement
// (or a Plaid re-sync) still produces the same hashes and is correctly skipped.
function dedupeHash(base: string, occurrence: number): string {
  return crypto.createHash('sha256').update(`${base}#${occurrence}`).digest('hex')
}

/**
 * Shared importer used by both CSV import and Plaid sync. Validates rows,
 * de-duplicates (within the batch AND vs existing rows), auto-applies bank
 * rules, and inserts everything in one transaction. Returns counts. Caller is
 * responsible for auth and for confirming the bank account exists.
 */
export async function importBankTransactions(
  bankAccountId: string,
  rows: ImportRow[],
  opts: { dryRun?: boolean } = {}
): Promise<ImportResult> {
  const importBatchId = crypto.randomUUID()

  // Period lock: rows on/before the locked-through boundary can never be posted,
  // so drop them at import time rather than letting them sit un-postable. We
  // filter (skip) rather than hard-fail so the valid post-lock rows still import.
  const lock = await getPeriodLock()
  const lockedThroughDate = lock.lockedThrough
  const lockedThroughStr = lockedThroughDate ? lockedThroughDate.toISOString().slice(0, 10) : null

  // Validate, then assign each valid row a per-base occurrence number.
  let invalidCount = 0
  let skippedLockedCount = 0
  const occByBase = new Map<string, number>()
  const valid: Array<ImportRow & { hash: string }> = []
  for (const r of rows) {
    if (!r.date || !/^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
      invalidCount += 1
      continue
    }
    // Compare by calendar date (lexicographic on YYYY-MM-DD == chronological).
    if (lockedThroughStr && r.date <= lockedThroughStr) {
      skippedLockedCount += 1
      continue
    }
    const base = dedupeBase(bankAccountId, r.date, r.amount, r.description)
    const occ = occByBase.get(base) ?? 0
    occByBase.set(base, occ + 1)
    valid.push({ ...r, hash: dedupeHash(base, occ) })
  }

  // Dedupe vs existing transactions for this account (skips true re-imports).
  const hashes = valid.map((r) => r.hash)
  const existing = hashes.length
    ? await prisma.bankTransaction.findMany({
        where: { bankAccountId, dedupeHash: { in: hashes } },
        select: { dedupeHash: true },
      })
    : []
  const existingSet = new Set(existing.map((e) => e.dedupeHash).filter(Boolean) as string[])

  const toImport = valid.filter((r) => !existingSet.has(r.hash))
  const duplicateCount = valid.length - toImport.length

  if (opts.dryRun) {
    return {
      rowsTotal: rows.length,
      rowsToImport: toImport.length,
      rowsInserted: 0,
      rowsDuplicate: duplicateCount,
      rowsInvalid: invalidCount,
      rowsSkippedLocked: skippedLockedCount,
      lockedThrough: lockedThroughStr,
      importBatchId,
    }
  }

  // Pull active rules + the vendor index once for auto-apply.
  const rulesLite = await loadActiveRules()
  const vendorIndex = await loadVendorIndex()

  const now = new Date()
  const ruleHits = new Map<string, number>()
  const createData = toImport.map((r) => {
    const matchedRule = findBestRule(rulesLite, {
      bankAccountId,
      amount: r.amount,
      description: r.description,
      payee: r.payee,
      transactionDate: new Date(r.date),
    } satisfies BankTxLite)
    if (matchedRule) ruleHits.set(matchedRule.id, (ruleHits.get(matchedRule.id) ?? 0) + 1)
    // When the rule doesn't already carry a vendor, suggest one — pre-fill only on
    // a confident match to an EXISTING vendor (alias/exact/strong). Still pending:
    // suggestion only, no JE.
    let suggestedVendorId: string | null = null
    if (!matchedRule?.vendorId) {
      suggestedVendorId = suggestVendorForTx(r.payee, r.description, vendorIndex).vendorId
    }
    return {
      bankAccountId,
      transactionDate: new Date(r.date),
      description: r.description,
      amount: r.amount,
      balanceAfter: r.balanceAfter ?? null,
      status: 'pending', // autoAdd winners are posted post-commit by runAutoAdd
      memo: matchedRule?.memo || '',
      payee: matchedRule?.payee || r.payee || '',
      categoryGlAccountId: matchedRule?.categoryGlAccountId || null,
      vendorId: matchedRule?.vendorId || suggestedVendorId || null,
      taxCodeId: matchedRule?.taxCodeId || null,
      bankImportRuleId: matchedRule?.id || null,
      importBatchId,
      dedupeHash: r.hash,
    }
  })

  // All-or-nothing: insert all rows, bump matched rules, stamp lastSyncAt.
  if (createData.length > 0) {
    await prisma.$transaction([
      prisma.bankTransaction.createMany({ data: createData }),
      ...Array.from(ruleHits.entries()).map(([ruleId, count]) =>
        prisma.bankRule.update({
          where: { id: ruleId },
          data: { matchCount: { increment: count }, lastMatchedAt: now },
        })
      ),
      prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { lastSyncAt: now },
      }),
    ])

    // Post the autoAdd winners now that the rows (and their ids) exist.
    await runAutoAdd({ bankAccountId, importBatchId }, rulesLite)
  }

  return {
    rowsTotal: rows.length,
    rowsToImport: toImport.length,
    rowsInserted: createData.length,
    rowsDuplicate: duplicateCount,
    rowsInvalid: invalidCount,
    rowsSkippedLocked: skippedLockedCount,
    lockedThrough: lockedThroughStr,
    importBatchId,
  }
}

// ---- Plaid: upsert by transaction_id (the canonical pattern) ----

export interface PlaidImportTxn {
  plaidTransactionId: string
  date: string // YYYY-MM-DD
  description: string
  payee: string
  amount: number // app sign: negative = money out
}

export interface PlaidImportResult {
  inserted: number
  updated: number
  skipped: number // existing posted/excluded rows left untouched
}

/**
 * Collapse a Plaid import batch to one row per plaid_transaction_id. Plaid's
 * `/transactions/sync` `added` list can repeat the same id within a single page,
 * and since we dedup against already-committed rows (not the in-flight batch), a
 * repeat would otherwise become N identical inserts. Last occurrence wins so an
 * edited re-send keeps its latest fields.
 */
export function dedupePlaidImportTxns(txns: PlaidImportTxn[]): PlaidImportTxn[] {
  const byId = new Map<string, PlaidImportTxn>()
  for (const t of txns) byId.set(t.plaidTransactionId, t)
  return [...byId.values()]
}

/**
 * Upsert Plaid transactions keyed by plaid_transaction_id:
 *  - new id            -> create (rules auto-applied, status pending)
 *  - existing & pending -> refresh date/amount/description/payee (Plaid edited it)
 *  - existing & posted/excluded -> leave untouched (its journal entry depends on
 *    the amount; surfaced instead via the book-vs-Plaid balance difference)
 * `removed` deletions are handled by the caller (item-wide).
 */
export async function importPlaidTransactions(
  bankAccountId: string,
  rawTxns: PlaidImportTxn[]
): Promise<PlaidImportResult> {
  if (rawTxns.length === 0) return { inserted: 0, updated: 0, skipped: 0 }

  // Collapse within-batch duplicates before the existing-row lookup so a repeated
  // id can't slip past dedup and multiply into N identical inserts.
  const txns = dedupePlaidImportTxns(rawTxns)

  const ids = txns.map((t) => t.plaidTransactionId)
  const existing = await prisma.bankTransaction.findMany({
    where: { bankAccountId, plaidTransactionId: { in: ids } },
    select: { id: true, plaidTransactionId: true, status: true },
  })
  const existingByPlaidId = new Map(
    existing.map((e) => [e.plaidTransactionId as string, e])
  )

  const rulesLite = await loadActiveRules()
  const vendorIndex = await loadVendorIndex()
  const now = new Date()

  const toCreate: Prisma.BankTransactionCreateManyInput[] = []
  const pendingUpdates: Array<{ id: string; data: Prisma.BankTransactionUpdateInput }> = []
  const ruleHits = new Map<string, number>()
  let skipped = 0

  for (const t of txns) {
    const ex = existingByPlaidId.get(t.plaidTransactionId)
    if (!ex) {
      const matchedRule = findBestRule(rulesLite, {
        bankAccountId,
        amount: t.amount,
        description: t.description,
        payee: t.payee,
        transactionDate: new Date(t.date),
      } satisfies BankTxLite)
      if (matchedRule) ruleHits.set(matchedRule.id, (ruleHits.get(matchedRule.id) ?? 0) + 1)
      // Suggest a vendor when the rule carries none — confident existing-vendor
      // match only. Insert path only; leaves the existing-pending branch untouched.
      let suggestedVendorId: string | null = null
      if (!matchedRule?.vendorId) {
        suggestedVendorId = suggestVendorForTx(t.payee, t.description, vendorIndex).vendorId
      }
      toCreate.push({
        bankAccountId,
        transactionDate: new Date(t.date),
        description: t.description,
        amount: t.amount,
        balanceAfter: null,
        status: 'pending', // autoAdd winners are posted post-commit by runAutoAdd
        memo: matchedRule?.memo || '',
        payee: matchedRule?.payee || t.payee || '',
        categoryGlAccountId: matchedRule?.categoryGlAccountId || null,
        vendorId: matchedRule?.vendorId || suggestedVendorId || null,
        taxCodeId: matchedRule?.taxCodeId || null,
        bankImportRuleId: matchedRule?.id || null,
        plaidTransactionId: t.plaidTransactionId,
      })
    } else if (ex.status === 'pending') {
      pendingUpdates.push({
        id: ex.id,
        data: {
          transactionDate: new Date(t.date),
          description: t.description,
          amount: t.amount,
          ...(t.payee ? { payee: t.payee } : {}),
        },
      })
    } else {
      skipped += 1
    }
  }

  const ops: Prisma.PrismaPromise<unknown>[] = []
  if (toCreate.length)
    ops.push(prisma.bankTransaction.createMany({ data: toCreate, skipDuplicates: true }))
  for (const u of pendingUpdates) {
    ops.push(prisma.bankTransaction.update({ where: { id: u.id }, data: u.data }))
  }
  for (const [ruleId, count] of ruleHits) {
    ops.push(
      prisma.bankRule.update({
        where: { id: ruleId },
        data: { matchCount: { increment: count }, lastMatchedAt: now },
      })
    )
  }
  ops.push(prisma.bankAccount.update({ where: { id: bankAccountId }, data: { lastSyncAt: now } }))
  await prisma.$transaction(ops)

  // Post the autoAdd winners among the rows just created.
  if (toCreate.length) {
    const createdPlaidIds = toCreate.map((t) => t.plaidTransactionId as string)
    await runAutoAdd({ bankAccountId, plaidTransactionId: { in: createdPlaidIds } }, rulesLite)
  }

  return { inserted: toCreate.length, updated: pendingUpdates.length, skipped }
}
