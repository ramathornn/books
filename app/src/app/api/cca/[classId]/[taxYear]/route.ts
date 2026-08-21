import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { createJournalEntry } from '@/lib/journalEntry'
import { audit } from '@/lib/audit'
import {
  buildClassSchedule,
  computedYearFor,
  persistComputedYear,
  fiscalYearEndDate,
  getFiscalYearEnd,
  lockedYearSet,
  type ComputedYear,
  type ClassRow,
} from '@/lib/cca/service'

/**
 * Per (class, taxYear) CCA editor + posting.
 *
 *   GET   /api/cca/[classId]/[taxYear]   → computed year + CcaJournalPreview lines
 *   PATCH /api/cca/[classId]/[taxYear]   → save additions/dispositions/overrides (OPEN years only)
 *   POST  /api/cca/[classId]/[taxYear]   → post the annual CCA JE (DR expense / CR accum. dep.)
 *
 * PERIOD_LOCKED is surfaced explicitly on PATCH and POST.
 */

function parseYear(v: string): number | null {
  const n = parseInt(v, 10)
  if (!Number.isInteger(n) || n < 1990 || n > 2200) return null
  return n
}

/** The DR/CR journal lines a CCA claim would post for a computed year. */
function journalPreview(cls: ClassRow, y: ComputedYear) {
  const amount = y.ccaClaimed
  if (!cls.expenseAccountId || !cls.accumDepAccountId) {
    return {
      lines: [],
      amount,
      missingAccounts: true as const,
    }
  }
  return {
    missingAccounts: false as const,
    amount,
    lines: [
      {
        glAccountId: cls.expenseAccountId,
        description: `CCA class ${cls.classNumber} — ${y.taxYear} depreciation`,
        debit: amount,
        credit: 0,
      },
      {
        glAccountId: cls.accumDepAccountId,
        description: `CCA class ${cls.classNumber} — ${y.taxYear} accumulated amortization`,
        debit: 0,
        credit: amount,
      },
    ],
  }
}

async function resolveAccountLabels(ids: Array<string | null>) {
  const real = ids.filter((x): x is string => !!x)
  if (real.length === 0) return new Map<string, { accountNumber: string; accountName: string }>()
  const accts = await prisma.gLAccount.findMany({
    where: { id: { in: real } },
    select: { id: true, accountNumber: true, accountName: true },
  })
  return new Map(accts.map((a) => [a.id, { accountNumber: a.accountNumber, accountName: a.accountName }]))
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ classId: string; taxYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { classId, taxYear: taxYearStr } = await params
  const taxYear = parseYear(taxYearStr)
  if (taxYear === null) return Response.json({ error: 'invalid taxYear' }, { status: 400 })

  const computed = await computedYearFor(classId, taxYear)
  if (!computed) return Response.json({ error: 'Class not found' }, { status: 404 })
  const { schedule, year } = computed
  if (!year) {
    return Response.json(
      { error: `No schedule data for class through ${taxYear}. Seed an opening UCC first.` },
      { status: 404 },
    )
  }

  const preview = journalPreview(schedule.class, year)
  const labels = await resolveAccountLabels([
    schedule.class.expenseAccountId,
    schedule.class.accumDepAccountId,
    schedule.class.assetAccountId,
  ])

  return Response.json({
    class: schedule.class,
    year,
    journalPreview: {
      ...preview,
      lines: preview.lines.map((l) => ({
        ...l,
        account: labels.get(l.glAccountId) ?? null,
      })),
    },
    // surrounding years for context (prev closing / next opening)
    prevYear: schedule.years.find((yy) => yy.taxYear === taxYear - 1) ?? null,
    nextYear: schedule.years.find((yy) => yy.taxYear === taxYear + 1) ?? null,
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string; taxYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { classId, taxYear: taxYearStr } = await params
  const taxYear = parseYear(taxYearStr)
  if (taxYear === null) return Response.json({ error: 'invalid taxYear' }, { status: 400 })

  const cls = await prisma.ccaClass.findUnique({ where: { id: classId } })
  if (!cls) return Response.json({ error: 'Class not found' }, { status: 404 })

  const fye = await getFiscalYearEnd()
  const isLocked = await lockedYearSet(fye)
  if (isLocked(taxYear)) {
    return Response.json(
      {
        error: `Tax year ${taxYear} is locked. Prior-year corrections are booked as a catch-up in the first open year, not by editing a filed year.`,
        code: 'PERIOD_LOCKED',
      },
      { status: 409 },
    )
  }

  const existing = await prisma.ccaScheduleEntry.findUnique({
    where: { classId_taxYear: { classId, taxYear } },
  })
  if (existing && existing.status === 'posted') {
    return Response.json(
      { error: `${taxYear} CCA is already posted (JE exists). Unpost/reverse before editing.` },
      { status: 409 },
    )
  }

  const body = await request.json().catch(() => ({}))
  const additions = body.additions !== undefined ? Number(body.additions) : undefined
  const dispositions = body.dispositions !== undefined ? Number(body.dispositions) : undefined
  const rateOverride = body.ccaRate !== undefined ? Number(body.ccaRate) : undefined

  if (additions !== undefined && (!Number.isFinite(additions) || additions < 0)) {
    return Response.json({ error: 'additions must be ≥ 0' }, { status: 400 })
  }
  if (dispositions !== undefined && (!Number.isFinite(dispositions) || dispositions < 0)) {
    return Response.json({ error: 'dispositions must be ≥ 0' }, { status: 400 })
  }

  const overrides: Record<string, number> = {
    ...((existing?.overrides as Record<string, number> | null) ?? {}),
  }
  if (additions !== undefined) overrides.additions = additions
  if (dispositions !== undefined) overrides.dispositions = dispositions
  if (rateOverride !== undefined) overrides.ccaRate = rateOverride
  const isOverridden = rateOverride !== undefined || (existing?.overrides as Record<string, number> | null)?.ccaRate != null

  // Upsert the user inputs first so the schedule recompute picks them up.
  await prisma.ccaScheduleEntry.upsert({
    where: { classId_taxYear: { classId, taxYear } },
    create: {
      classId,
      taxYear,
      openingUcc: new Prisma.Decimal(0),
      closingUcc: new Prisma.Decimal(0),
      ccaRate: cls.rate,
      additions: new Prisma.Decimal(additions ?? 0),
      dispositions: new Prisma.Decimal(dispositions ?? 0),
      overrides,
      isOverridden,
      status: 'draft',
    },
    update: {
      ...(additions !== undefined ? { additions: new Prisma.Decimal(additions) } : {}),
      ...(dispositions !== undefined ? { dispositions: new Prisma.Decimal(dispositions) } : {}),
      overrides,
      isOverridden,
    },
  })

  // Recompute the rolled-forward schedule and persist every open year (so closing
  // UCC of this year flows into later open years immediately).
  const schedule = await buildClassSchedule(classId, { throughYear: taxYear })
  if (schedule) {
    for (const y of schedule.years) {
      if (!y.locked) await persistComputedYear(classId, y)
    }
  }

  const refreshed = await computedYearFor(classId, taxYear)
  return Response.json({ ok: true, year: refreshed?.year ?? null })
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ classId: string; taxYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { classId, taxYear: taxYearStr } = await params
  const taxYear = parseYear(taxYearStr)
  if (taxYear === null) return Response.json({ error: 'invalid taxYear' }, { status: 400 })

  const computed = await computedYearFor(classId, taxYear)
  if (!computed?.year) {
    return Response.json({ error: 'No schedule data to post; seed/compute first.' }, { status: 404 })
  }
  const { schedule, year } = computed
  const cls = schedule.class

  // Idempotency: already posted → return the existing JE.
  const existing = await prisma.ccaScheduleEntry.findUnique({
    where: { classId_taxYear: { classId, taxYear } },
  })
  if (existing?.journalEntryId) {
    return Response.json({
      ok: true,
      alreadyPosted: true,
      journalEntryId: existing.journalEntryId,
      ccaClaimed: Number(existing.ccaClaimed),
    })
  }

  if (!cls.expenseAccountId || !cls.accumDepAccountId) {
    return Response.json(
      { error: 'This class has no depreciation expense and/or accumulated amortization account configured.' },
      { status: 422 },
    )
  }

  const preview = journalPreview(cls, year)
  if (preview.amount <= 0) {
    // Nothing to depreciate — persist the (open) row but post no JE.
    await persistComputedYear(classId, year)
    return Response.json({ ok: true, journalEntryId: null, ccaClaimed: 0, note: 'No CCA to claim for this year.' })
  }

  const fye = await getFiscalYearEnd()
  const entryDate = fiscalYearEndDate(taxYear, fye)

  // createJournalEntry runs assertNotLocked(entryDate); a locked year → PERIOD_LOCKED.
  let je
  try {
    je = await createJournalEntry({
      entryDate,
      description: `CCA class ${cls.classNumber} — ${taxYear}`,
      memo: `Capital cost allowance, class ${cls.classNumber} (${cls.description}), tax year ${taxYear}`,
      status: 'posted',
      kind: 'cca',
      lines: preview.lines,
    })
  } catch (e) {
    const err = e as Error & { code?: string }
    if (err.code === 'PERIOD_LOCKED') {
      return Response.json({ error: err.message, code: 'PERIOD_LOCKED' }, { status: 409 })
    }
    return Response.json({ error: err.message || 'Failed to post CCA entry' }, { status: 400 })
  }

  // Persist the computed numbers and link the JE. journalEntryId is @unique — a
  // race that double-posts trips P2002; reverse the loser to avoid a dangling JE.
  try {
    await prisma.ccaScheduleEntry.upsert({
      where: { classId_taxYear: { classId, taxYear } },
      create: {
        classId,
        taxYear,
        openingUcc: new Prisma.Decimal(year.openingUcc),
        additions: new Prisma.Decimal(year.additions),
        dispositions: new Prisma.Decimal(year.dispositions),
        halfYearAdjustment: new Prisma.Decimal(year.halfYearAdjustment),
        accIiAddition: new Prisma.Decimal(year.accIiAddition),
        ccaRate: new Prisma.Decimal(year.ccaRate),
        ccaBase: new Prisma.Decimal(year.ccaBase),
        ccaMax: new Prisma.Decimal(year.ccaMax),
        ccaClaimed: new Prisma.Decimal(year.ccaClaimed),
        closingUcc: new Prisma.Decimal(year.closingUcc),
        method: year.method,
        status: 'posted',
        journalEntryId: je.id,
        postedAt: new Date(),
      },
      update: {
        openingUcc: new Prisma.Decimal(year.openingUcc),
        additions: new Prisma.Decimal(year.additions),
        dispositions: new Prisma.Decimal(year.dispositions),
        halfYearAdjustment: new Prisma.Decimal(year.halfYearAdjustment),
        accIiAddition: new Prisma.Decimal(year.accIiAddition),
        ccaRate: new Prisma.Decimal(year.ccaRate),
        ccaBase: new Prisma.Decimal(year.ccaBase),
        ccaMax: new Prisma.Decimal(year.ccaMax),
        ccaClaimed: new Prisma.Decimal(year.ccaClaimed),
        closingUcc: new Prisma.Decimal(year.closingUcc),
        method: year.method,
        status: 'posted',
        journalEntryId: je.id,
        postedAt: new Date(),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const { reverseJournalEntry } = await import('@/lib/reverseJournalEntry')
      await reverseJournalEntry(je.id, `Duplicate CCA post for class ${cls.classNumber} ${taxYear}`).catch(() => {})
      const row = await prisma.ccaScheduleEntry.findUnique({ where: { classId_taxYear: { classId, taxYear } } })
      return Response.json({ ok: true, alreadyPosted: true, journalEntryId: row?.journalEntryId ?? null })
    }
    throw e
  }

  await audit({
    entityType: 'journal_entry',
    entityId: je.id,
    action: 'post',
    summary: `CCA class ${cls.classNumber} ${taxYear} · ${preview.amount.toFixed(2)} → ${je.entryNumber}`,
    metadata: {
      module: 'cca',
      classId,
      classNumber: cls.classNumber,
      taxYear,
      ccaClaimed: preview.amount,
      closingUcc: year.closingUcc,
    },
  })

  return Response.json({ ok: true, journalEntryId: je.id, entryNumber: je.entryNumber, ccaClaimed: preview.amount })
}
