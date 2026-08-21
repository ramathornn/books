import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { createJournalEntry } from '@/lib/journalEntry'
import { setPeriodLock, getPeriodLock } from '@/lib/periodLock'
import { audit } from '@/lib/audit'
import { Prisma } from '@/generated/prisma/client'
import {
  buildFiscalYearClosePreview,
  fiscalYearBounds,
  findRetainedEarningsAccount,
} from '@/lib/fiscalYearClose'

function parseFiscalYear(value: unknown): number | null {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value)
  if (!Number.isInteger(n)) return null
  if (n < 1990 || n > 2200) return null
  return n
}

/**
 * PREVIEW the year-end close. Read-only: computes net income for the fiscal
 * year and the exact closing entries that COMMIT would post. Posts nothing.
 *
 *   GET /api/fiscal-year-close?fiscalYear=2025
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const fiscalYear = parseFiscalYear(request.nextUrl.searchParams.get('fiscalYear'))
  if (fiscalYear === null) {
    return Response.json({ error: 'fiscalYear required (e.g. 2025)' }, { status: 400 })
  }

  const preview = await buildFiscalYearClosePreview(fiscalYear)
  return Response.json(preview)
}

/**
 * COMMIT the year-end close. Posts the closing journal entry (DR income / CR
 * expense / net to Retained Earnings), records a FiscalYearClose row, and
 * advances the period lock to Dec 31 of the fiscal year.
 *
 * - NEVER auto-commits: only runs on this explicit POST.
 * - Idempotent per fiscalYear: a second call returns the existing close.
 *
 *   POST /api/fiscal-year-close   { "fiscalYear": 2025 }
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as { id?: string }).id ?? null

  const body = await request.json().catch(() => ({}))
  const fiscalYear = parseFiscalYear((body as { fiscalYear?: unknown }).fiscalYear)
  if (fiscalYear === null) {
    return Response.json({ error: 'fiscalYear required (e.g. 2025)' }, { status: 400 })
  }

  // Idempotency guard #1: already closed → return the existing row, post nothing.
  const existing = await prisma.fiscalYearClose.findUnique({ where: { fiscalYear } })
  if (existing) {
    return Response.json({
      ok: true,
      alreadyClosed: true,
      fiscalYear,
      journalEntryId: existing.closingJournalEntryId,
      netIncome: Number(existing.netIncome),
      closedAt: existing.closedAt.toISOString(),
    })
  }

  const preview = await buildFiscalYearClosePreview(fiscalYear)

  const re = await findRetainedEarningsAccount()
  if (!re) {
    return Response.json(
      { error: 'No Retained Earnings equity account found in the chart of accounts.' },
      { status: 422 }
    )
  }

  if (preview.closingLines.length === 0) {
    // Nothing to close (no income/expense activity). Still record the close and
    // advance the lock so the year is sealed.
    let fyc
    try {
      fyc = await prisma.fiscalYearClose.create({
        data: {
          fiscalYear,
          closingJournalEntryId: null,
          retainedEarningsAccountId: re.id,
          netIncome: new Prisma.Decimal(0),
        },
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await prisma.fiscalYearClose.findUnique({ where: { fiscalYear } })
        return Response.json({ ok: true, alreadyClosed: true, fiscalYear, journalEntryId: row?.closingJournalEntryId ?? null, netIncome: Number(row?.netIncome ?? 0) })
      }
      throw e
    }
    await advanceLockToYearEnd(fiscalYear, userId)
    await audit({
      entityType: 'journal_entry',
      entityId: fyc.id,
      action: 'finish',
      summary: `Fiscal year ${fiscalYear} closed · no income/expense activity · net 0.00`,
      metadata: { fiscalYear, netIncome: 0, closingJournalEntryId: null },
    })
    return Response.json({ ok: true, fiscalYear, journalEntryId: null, netIncome: 0 })
  }

  const { end } = fiscalYearBounds(fiscalYear)

  // Post the closing JE dated at fiscal year-end. createJournalEntry runs
  // assertNotLocked(end) — so if the year is ALREADY locked through Dec 31, this
  // throws PERIOD_LOCKED and we never double-close. We advance the lock only
  // AFTER the JE posts.
  let je
  try {
    je = await createJournalEntry({
      entryDate: end,
      description: `Year-end close FY${fiscalYear}`,
      memo: `Closes income & expense accounts to Retained Earnings (${re.accountNumber} ${re.accountName})`,
      status: 'posted',
      kind: 'closing',
      lines: preview.closingLines,
    })
  } catch (e) {
    const err = e as Error & { code?: string }
    if (err.code === 'PERIOD_LOCKED') {
      return Response.json({ error: err.message, code: 'PERIOD_LOCKED' }, { status: 409 })
    }
    return Response.json({ error: err.message || 'Failed to post closing entry' }, { status: 400 })
  }

  // Record the close. Unique(fiscalYear) is the idempotency backstop against a
  // race that slipped past guard #1.
  let fyc
  try {
    fyc = await prisma.fiscalYearClose.create({
      data: {
        fiscalYear,
        closingJournalEntryId: je.id,
        retainedEarningsAccountId: re.id,
        netIncome: new Prisma.Decimal(preview.netIncome),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      // Lost a race; reverse the JE we just posted so we don't leave a dangling
      // closing entry, then return the winner's row.
      const { reverseJournalEntry } = await import('@/lib/reverseJournalEntry')
      await reverseJournalEntry(je.id, `Duplicate close for FY${fiscalYear} — superseded`).catch(() => {})
      const row = await prisma.fiscalYearClose.findUnique({ where: { fiscalYear } })
      return Response.json({
        ok: true,
        alreadyClosed: true,
        fiscalYear,
        journalEntryId: row?.closingJournalEntryId ?? null,
        netIncome: Number(row?.netIncome ?? 0),
      })
    }
    throw e
  }

  await advanceLockToYearEnd(fiscalYear, userId)

  await audit({
    entityType: 'journal_entry',
    entityId: je.id,
    action: 'finish',
    summary: `Year-end close FY${fiscalYear} · net income ${preview.netIncome.toFixed(2)} → Retained Earnings`,
    metadata: {
      fiscalYear,
      netIncome: preview.netIncome,
      totalIncome: preview.totalIncome,
      totalExpense: preview.totalExpense,
      closingJournalEntryId: je.id,
      fiscalYearCloseId: fyc.id,
      retainedEarningsAccountId: re.id,
      lineCount: preview.closingLines.length,
    },
  })

  return Response.json({
    ok: true,
    fiscalYear,
    journalEntryId: je.id,
    netIncome: preview.netIncome,
  })
}

/**
 * Advance the period lock to Dec 31 of the fiscal year — but never move it
 * backwards if a later period is already locked.
 */
async function advanceLockToYearEnd(fiscalYear: number, userId: string | null): Promise<void> {
  const { end } = fiscalYearBounds(fiscalYear)
  const current = await getPeriodLock()
  if (current.lockedThrough && current.lockedThrough.getTime() >= end.getTime()) {
    return
  }
  await setPeriodLock({
    lockedThrough: end,
    userId,
    notes: `${current.notes ? current.notes + ' · ' : ''}Locked by year-end close FY${fiscalYear}`.slice(0, 500),
  })
  await audit({
    entityType: 'period_lock',
    entityId: 'singleton',
    action: 'lock',
    summary: `Period locked through ${end.toISOString().slice(0, 10)} by year-end close FY${fiscalYear}`,
    metadata: { fiscalYear, lockedThrough: end.toISOString() },
  })
}
