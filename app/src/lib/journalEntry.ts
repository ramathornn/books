import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { assertNotLocked } from '@/lib/periodLock'
import { audit } from '@/lib/audit'

export interface JELine {
  glAccountId: string
  description: string
  debit: number
  credit: number
  taxCodeId?: string | null
}

// Numeric max of existing JE-* numbers. NOT a lexicographic orderBy — as a
// string 'JE-9999' sorts above 'JE-10000', which past 10k entries would make
// allocation return a taken number forever.
async function maxEntryNumber(db: Pick<Prisma.TransactionClient, '$queryRaw'>): Promise<number> {
  const rows = await db.$queryRaw<Array<{ entry_number: string }>>`
    SELECT entry_number FROM journal_entries
    WHERE entry_number ~ '^JE-[0-9]+$'
    ORDER BY length(entry_number) DESC, entry_number DESC
    LIMIT 1
  `
  return rows[0] ? parseInt(rows[0].entry_number.replace(/^JE-/, ''), 10) || 0 : 0
}

/**
 * Generate the next sequential entry number (JE-0001, JE-0002, etc).
 */
export async function nextEntryNumber(): Promise<string> {
  const lastNum = await maxEntryNumber(prisma)
  return `JE-${String(lastNum + 1).padStart(4, '0')}`
}

export interface CreateJEInput {
  entryDate: Date
  description: string
  memo?: string
  status?: 'draft' | 'posted'
  kind?: string
  /**
   * Eligibility tag for dividend declarations ('eligible' | 'nonEligible').
   * Only meaningful when `kind === 'dividend'`; null/undefined on every other
   * entry. The T5 GL pull groups dividends-declared debits by this value to
   * route amounts to boxes 24/25/26 (eligible) vs 10/11/12 (non-eligible).
   */
  dividendEligibility?: 'eligible' | 'nonEligible' | null
  reversesId?: string | null
  /**
   * Optional client-supplied dedupe key. Unique across all journal entries —
   * a second create with the same key fails with a P2002 unique violation
   * instead of double-booking; callers catch it and return the original entry.
   */
  idempotencyKey?: string | null
  lines: JELine[]
  /**
   * When provided, all DB work runs on this transaction client instead of
   * opening a fresh `prisma.$transaction`. Lets callers compose the JE inside a
   * larger atomic unit (e.g. posting an invoice accrual + linking the JE).
   */
  client?: Prisma.TransactionClient
}

// Unique violation specifically on entry_number — the only collision the
// create loop should retry. A collision on idempotency_key means a genuine
// replay and must surface to the caller, not be retried into a double-post.
function isEntryNumberCollision(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = (e.meta as { target?: string[] | string } | undefined)?.target
  const fields = Array.isArray(target) ? target.join(',') : String(target ?? '')
  return fields.includes('entry_number') || fields.includes('entryNumber')
}

async function allocateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
  const lastNum = await maxEntryNumber(tx)
  return `JE-${String(lastNum + 1).padStart(4, '0')}`
}

async function createJEOnTx(tx: Prisma.TransactionClient, input: CreateJEInput, totalDebit: number, totalCredit: number) {
  const status = input.status ?? 'posted'
  // Collision-safe entry-number allocation: retry once on a unique violation
  // (a concurrent writer grabbed the same number between read and insert).
  let je
  let attempt = 0
  for (;;) {
    const entryNumber = await allocateEntryNumber(tx)
    try {
      je = await tx.journalEntry.create({
        data: {
          entryNumber,
          entryDate: input.entryDate,
          description: input.description,
          memo: input.memo ?? '',
          status,
          kind: input.kind ?? 'standard',
          dividendEligibility: input.dividendEligibility ?? null,
          reversesId: input.reversesId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          totalDebit,
          totalCredit,
          postedAt: status === 'posted' ? new Date() : null,
          lines: {
            create: input.lines.map((l, i) => ({
              glAccountId: l.glAccountId,
              description: l.description,
              debit: l.debit,
              credit: l.credit,
              taxCodeId: l.taxCodeId ?? null,
              sortOrder: i,
            })),
          },
        },
      })
      break
    } catch (e) {
      if (isEntryNumberCollision(e) && attempt < 1) {
        attempt++
        continue
      }
      throw e
    }
  }

  if (status === 'posted') {
    await applyJEToBalances(tx, input.lines, +1)
  }

  return je
}

/**
 * Create + (optionally) post a balanced journal entry.
 * Updates GLAccount.currentBalance for each line based on the account's class.
 */
export async function createJournalEntry(input: CreateJEInput) {
  // Period lock — refuse to create dated entries inside a locked period
  await assertNotLocked(input.entryDate)

  // Validate balanced
  const totalDebit = input.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = input.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(
      `Journal entry must be balanced (debits=${totalDebit.toFixed(2)}, credits=${totalCredit.toFixed(2)})`
    )
  }

  const je = input.client
    ? await createJEOnTx(input.client, input, totalDebit, totalCredit)
    : await prisma.$transaction((tx) => createJEOnTx(tx, input, totalDebit, totalCredit))

  await audit({
    entityType: 'journal_entry',
    entityId: je.id,
    action: input.status === 'draft' ? 'create' : 'post',
    summary: `${je.entryNumber} · ${input.description.slice(0, 80)} · ${totalDebit.toFixed(2)}`,
    metadata: { totalDebit, totalCredit, lineCount: input.lines.length },
  })
  return je
}

export interface UpdateJEInput {
  entryDate: Date
  description: string
  memo?: string
  status?: 'draft' | 'posted'
  lines: JELine[]
}

/**
 * Update a draft journal entry (posted entries are immutable — reverse them
 * instead). Line replacement, header update, and — when the update posts the
 * draft — balance application all run in one transaction, so a crash can never
 * leave lines and `currentBalance` disagreeing. `assertNotLocked` guards the
 * new entryDate (PERIOD_LOCKED).
 */
export async function updateJournalEntry(journalEntryId: string, input: UpdateJEInput) {
  const current = await prisma.journalEntry.findUnique({
    where: { id: journalEntryId },
    select: { id: true, status: true, entryNumber: true },
  })
  if (!current) throw new Error('Journal entry not found')
  if (current.status !== 'draft') {
    throw new Error('Only draft entries can be edited; reverse posted entries instead')
  }

  await assertNotLocked(input.entryDate)

  const totalDebit = input.lines.reduce((s, l) => s + Number(l.debit || 0), 0)
  const totalCredit = input.lines.reduce((s, l) => s + Number(l.credit || 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw new Error(
      `Journal entry must be balanced (debits=${totalDebit.toFixed(2)}, credits=${totalCredit.toFixed(2)})`
    )
  }

  const status = input.status ?? 'draft'
  const je = await prisma.$transaction(async (tx) => {
    await tx.journalEntryLine.deleteMany({ where: { journalEntryId } })
    const updated = await tx.journalEntry.update({
      where: { id: journalEntryId },
      data: {
        entryDate: input.entryDate,
        description: input.description,
        memo: input.memo ?? '',
        status,
        totalDebit,
        totalCredit,
        postedAt: status === 'posted' ? new Date() : null,
        lines: {
          create: input.lines.map((l, i) => ({
            glAccountId: l.glAccountId,
            description: l.description,
            debit: l.debit,
            credit: l.credit,
            taxCodeId: l.taxCodeId ?? null,
            sortOrder: i,
          })),
        },
      },
    })
    if (status === 'posted') {
      await applyJEToBalances(tx, input.lines, +1)
    }
    return updated
  })

  await audit({
    entityType: 'journal_entry',
    entityId: je.id,
    action: status === 'posted' ? 'post' : 'update',
    summary: `${je.entryNumber} · ${input.description.slice(0, 80)} · ${totalDebit.toFixed(2)}`,
    metadata: { totalDebit, totalCredit, lineCount: input.lines.length },
  })
  return je
}

/**
 * Reverse / void a journal entry.
 *
 * - posted: delegates to `reverseJournalEntry`, which posts an inverse
 *   `kind:'reversal'` JE at the original entryDate (audit-safe, never deletes,
 *   throws PERIOD_LOCKED if the original date is locked). The original stays
 *   `status:'posted'`; balances are corrected by the reversal's own lines.
 * - draft: fast-path — there is nothing posted to reverse, so just subtract any
 *   accidentally-applied effect and mark it void.
 *
 * Use this when un-categorizing a bank transaction.
 */
export async function voidJournalEntry(journalEntryId: string, reason = 'Voided') {
  const je = await prisma.journalEntry.findUnique({
    where: { id: journalEntryId },
    select: { id: true, status: true },
  })
  if (!je) throw new Error('Journal entry not found')
  if (je.status === 'void') return je

  if (je.status === 'posted') {
    // Lazy import to avoid a circular dependency
    // (reverseJournalEntry imports createJournalEntry from this module).
    const { reverseJournalEntry } = await import('@/lib/reverseJournalEntry')
    return reverseJournalEntry(journalEntryId, reason)
  }

  // draft fast-path
  return prisma.$transaction(async (tx) => {
    const draft = await tx.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: { lines: true },
    })
    if (!draft) throw new Error('Journal entry not found')
    if (draft.status === 'void') return draft

    return tx.journalEntry.update({
      where: { id: journalEntryId },
      data: { status: 'void' },
    })
  })
}

async function applyJEToBalances(
  tx: Prisma.TransactionClient,
  lines: Array<{ glAccountId: string; debit: number | string; credit: number | string }>,
  sign: 1 | -1
) {
  // Group by account and net debit-credit
  const byAccount = new Map<string, number>()
  for (const l of lines) {
    const d = Number(l.debit || 0)
    const c = Number(l.credit || 0)
    byAccount.set(l.glAccountId, (byAccount.get(l.glAccountId) || 0) + (d - c))
  }
  for (const [glAccountId, netDebit] of byAccount) {
    const acct = await tx.gLAccount.findUnique({ where: { id: glAccountId } })
    if (!acct) throw new Error(`GL account ${glAccountId} not found while applying journal entry to balances`)
    // Asset/Expense: debit increases balance. Liability/Equity/Income: credit increases balance.
    const isDebitNormal = acct.accountClass === 'asset' || acct.accountClass === 'expense'
    const delta = isDebitNormal ? netDebit : -netDebit
    await tx.gLAccount.update({
      where: { id: glAccountId },
      data: { currentBalance: { increment: sign * delta } },
    })
  }
}
