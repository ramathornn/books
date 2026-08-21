import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { computeCca } from '@/lib/tax/compute/cca'
import { lockedYearSet, getFiscalYearEnd } from '@/lib/cca/service'

/**
 * Seed a class's opening UCC for a starting tax year.
 *
 *   POST /api/cca/seed  { classId, taxYear, openingUcc, additions?, dispositions? }
 *
 * Creates (or replaces, if still draft) the first CcaScheduleEntry for the class
 * with `isSeed=true`. The opening UCC is the user's brought-forward balance
 * (e.g. from the prior accountant's Schedule 8). CCA is computed immediately so
 * the seed row carries a full picture, but nothing is posted to the GL here.
 *
 * Refuses to seed into a LOCKED year, or to overwrite a non-draft seed row.
 */

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const classId = String(body.classId ?? '')
  const taxYear = Number(body.taxYear)
  const openingUcc = Number(body.openingUcc)
  const additions = Number(body.additions ?? 0)
  const dispositions = Number(body.dispositions ?? 0)

  if (!classId) return Response.json({ error: 'classId required' }, { status: 400 })
  if (!Number.isInteger(taxYear) || taxYear < 1990 || taxYear > 2200) {
    return Response.json({ error: 'valid taxYear required' }, { status: 400 })
  }
  if (!Number.isFinite(openingUcc) || openingUcc < 0) {
    return Response.json({ error: 'openingUcc must be a non-negative number' }, { status: 400 })
  }

  const cls = await prisma.ccaClass.findUnique({ where: { id: classId } })
  if (!cls) return Response.json({ error: 'Class not found' }, { status: 404 })

  const fye = await getFiscalYearEnd()
  const isLocked = await lockedYearSet(fye)
  if (isLocked(taxYear)) {
    return Response.json(
      { error: `Tax year ${taxYear} is locked. Seed an OPEN year and roll forward instead.`, code: 'PERIOD_LOCKED' },
      { status: 409 },
    )
  }

  const existing = await prisma.ccaScheduleEntry.findUnique({
    where: { classId_taxYear: { classId, taxYear } },
  })
  if (existing && existing.status !== 'draft') {
    return Response.json(
      { error: `A ${existing.status} schedule entry already exists for ${taxYear}; cannot overwrite via seed.` },
      { status: 409 },
    )
  }

  const result = computeCca({
    taxYear,
    classNumber: cls.classNumber,
    rate: Number(cls.rate),
    openingUcc,
    additions,
    dispositions,
    halfYearRuleApplies: cls.halfYearRuleApplies,
    accIiEligible: cls.accIiEligible,
  })

  const data = {
    openingUcc: new Prisma.Decimal(result.openingUcc),
    additions: new Prisma.Decimal(result.additions),
    dispositions: new Prisma.Decimal(result.dispositions),
    halfYearAdjustment: new Prisma.Decimal(result.halfYearAdjustment),
    accIiAddition: new Prisma.Decimal(result.accIiAddition),
    ccaRate: new Prisma.Decimal(result.ccaRate),
    ccaBase: new Prisma.Decimal(result.ccaBase),
    ccaMax: new Prisma.Decimal(result.ccaMax),
    ccaClaimed: new Prisma.Decimal(result.ccaClaimed),
    closingUcc: new Prisma.Decimal(result.closingUcc),
    method: result.method,
    isSeed: true,
    status: 'draft',
  }

  const row = await prisma.ccaScheduleEntry.upsert({
    where: { classId_taxYear: { classId, taxYear } },
    create: { classId, taxYear, ...data },
    update: data,
  })

  return Response.json({ ok: true, id: row.id, result })
}
