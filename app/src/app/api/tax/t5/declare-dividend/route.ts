import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { Prisma } from '@/generated/prisma/client'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import {
  declareDividend,
  getDividendsDeclaredAccountId,
  GripOverDesignationError,
} from '@/lib/tax/declareDividend'
import { computeGripRoom } from '@/lib/tax/gripRoom'

/**
 * "Declare dividend" flow (T5, locked user decision).
 *
 *   GET  /api/tax/t5/declare-dividend
 *     → wiring status: the configured Dividends Declared account + candidate
 *       credit accounts (liabilities / bank) for the JE.
 *   POST /api/tax/t5/declare-dividend { amount, creditAccountId, declaredDate,
 *                                       recipientLabel, memo? }
 *     → posts DR 3300 Dividends Declared / CR <creditAccount> and returns the JE.
 *
 * The T5 auto-pull (`computeT5`) then sums posted JE debits to the Dividends
 * Declared account for the year, so this declaration is the single source feeding
 * the slip. Period-lock is enforced inside createJournalEntry.
 */

export async function GET() {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const dividendsDeclaredAccountId = await getDividendsDeclaredAccountId()
  const dividendsDeclaredAccount = dividendsDeclaredAccountId
    ? await prisma.gLAccount.findUnique({
        where: { id: dividendsDeclaredAccountId },
        select: { id: true, accountNumber: true, accountName: true, currentBalance: true },
      })
    : null

  // Credit-side candidates: liabilities (Dividends Payable) and bank/asset
  // accounts (immediate payment).
  const creditCandidates = await prisma.gLAccount.findMany({
    where: { isArchived: false, accountClass: { in: ['liability', 'asset'] } },
    select: { id: true, accountNumber: true, accountName: true, accountClass: true },
    orderBy: { accountNumber: 'asc' },
  })

  // Live GRIP room as of today — the ceiling for an eligible designation
  // (BLOCKER 3). For the v1 persona this is $0 with no prior prepared T2.
  const gripRoom = await computeGripRoom({
    declaredDate: new Date(),
    dividendsDeclaredAccountId,
  })

  return Response.json({
    configured: !!dividendsDeclaredAccountId,
    dividendsDeclaredAccount,
    creditCandidates,
    gripRoom,
  })
}

export async function POST(request: NextRequest) {
  // Book a dividend via Bearer token (headless agents) OR an interactive session.
  const authed = await requireApiAuth(request)
  if (!authed.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: authed.status })
  }

  const dividendsDeclaredAccountId = await getDividendsDeclaredAccountId()
  if (!dividendsDeclaredAccountId) {
    return Response.json(
      { error: 'Dividends Declared account not configured. Run scripts/ensure-tax-accounts.ts.' },
      { status: 400 }
    )
  }

  const body = await request.json().catch(() => ({}))
  const amount = Number(body.amount)
  const creditAccountId = String(body.creditAccountId ?? '').trim()
  const recipientLabel = String(body.recipientLabel ?? '').trim()
  const declaredDateRaw = String(body.declaredDate ?? '').trim()
  const idempotencyKey = body.idempotencyKey ? String(body.idempotencyKey).trim() : null
  const allowDuplicate = body.allowDuplicate === true
  // Eligibility defaults to non-eligible (BLOCKER 3). Only an explicit
  // 'eligible' opts into the GRIP-gated eligible designation.
  const eligibility: 'eligible' | 'nonEligible' = body.eligibility === 'eligible' ? 'eligible' : 'nonEligible'

  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json({ error: 'A positive dividend amount is required.' }, { status: 400 })
  }
  if (!creditAccountId) {
    return Response.json({ error: 'A credit account (Dividends Payable or bank) is required.' }, { status: 400 })
  }
  if (!recipientLabel) {
    return Response.json({ error: 'A recipient label is required.' }, { status: 400 })
  }
  // Strict date: plain YYYY-MM-DD only. A datetime here lands the dividend on
  // the T5 but outside the T2 dividends-paid pull (UTC-midnight lte cutoff vs
  // local end-of-day), so reject anything with a time component or locale
  // format. The round-trip check rejects rollovers like 2025-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(declaredDateRaw)) {
    return Response.json(
      { error: 'declaredDate is required in YYYY-MM-DD format (no time component).' },
      { status: 400 }
    )
  }
  const declaredDate = new Date(declaredDateRaw)
  if (
    Number.isNaN(declaredDate.getTime()) ||
    declaredDate.toISOString().slice(0, 10) !== declaredDateRaw
  ) {
    return Response.json({ error: 'Invalid declared date.' }, { status: 400 })
  }

  const creditAccount = await prisma.gLAccount.findUnique({ where: { id: creditAccountId } })
  if (!creditAccount) return Response.json({ error: 'Credit account not found.' }, { status: 404 })

  // Idempotency: a replayed key returns 409 with the original entry, never a
  // second JE. (Belt: the unique constraint on idempotency_key also catches a
  // concurrent replay that slips past this read.)
  if (idempotencyKey) {
    const existing = await prisma.journalEntry.findUnique({
      where: { idempotencyKey },
      select: { id: true, entryNumber: true, totalDebit: true, entryDate: true },
    })
    if (existing) {
      return Response.json(
        {
          error: `Duplicate request: idempotencyKey already used by ${existing.entryNumber}.`,
          code: 'IDEMPOTENT_REPLAY',
          journalEntryId: existing.id,
          entryNumber: existing.entryNumber,
          amount: Number(existing.totalDebit),
        },
        { status: 409 }
      )
    }
  }

  // Duplicate-declaration guard: a posted (un-reversed) dividend JE with the
  // same date + amount + recipient needs an explicit allowDuplicate to book
  // again — a blind retry would otherwise double the T5 and Schedule 3.
  const roundedAmount = Math.round(amount * 100) / 100
  const duplicate = await prisma.journalEntry.findFirst({
    where: {
      kind: 'dividend',
      status: 'posted',
      reversedAt: null,
      entryDate: declaredDate,
      totalDebit: roundedAmount,
      description: { contains: recipientLabel },
    },
    select: { id: true, entryNumber: true },
  })
  if (duplicate && !allowDuplicate) {
    return Response.json(
      {
        error:
          `A dividend of ${roundedAmount.toFixed(2)} to "${recipientLabel}" dated ${declaredDateRaw} ` +
          `is already posted as ${duplicate.entryNumber}. Pass allowDuplicate:true to book another.`,
        code: 'DUPLICATE_DIVIDEND',
        journalEntryId: duplicate.id,
        entryNumber: duplicate.entryNumber,
      },
      { status: 409 }
    )
  }

  try {
    const result = await declareDividend({
      dividendsDeclaredAccountId,
      creditAccountId,
      amount,
      declaredDate,
      recipientLabel,
      eligibility,
      memo: body.memo ? String(body.memo) : undefined,
      idempotencyKey,
    })

    await audit({
      entityType: 'journal_entry',
      entityId: result.journalEntryId,
      action: 'post',
      summary: `Dividend declared — ${recipientLabel} (${result.amount.toFixed(2)})`,
      metadata: { kind: 'dividend', eligibility, amount: result.amount, declaredDate: declaredDate.toISOString() },
    })

    return Response.json({ ok: true, ...result }, { status: 201 })
  } catch (e) {
    // Excessive eligible designation (ITA 185.1) — block with 422 + room detail.
    if (e instanceof GripOverDesignationError) {
      return Response.json(
        { error: e.message, code: e.code, roomRemaining: e.roomRemaining, requested: e.requested },
        { status: 422 }
      )
    }
    // Concurrent replay: two requests with the same idempotencyKey raced past
    // the pre-check; the unique constraint stopped the loser. Return the winner.
    if (
      idempotencyKey &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const existing = await prisma.journalEntry.findUnique({
        where: { idempotencyKey },
        select: { id: true, entryNumber: true, totalDebit: true },
      })
      if (existing) {
        return Response.json(
          {
            error: `Duplicate request: idempotencyKey already used by ${existing.entryNumber}.`,
            code: 'IDEMPOTENT_REPLAY',
            journalEntryId: existing.id,
            entryNumber: existing.entryNumber,
            amount: Number(existing.totalDebit),
          },
          { status: 409 }
        )
      }
    }
    const msg = e instanceof Error ? e.message : 'Failed to declare dividend'
    // Surface period-lock distinctly (423 Locked, matching the JE routes).
    const status = /PERIOD_LOCKED|locked/i.test(msg) ? 423 : 400
    return Response.json({ error: msg }, { status })
  }
}
