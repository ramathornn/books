import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { audit } from '@/lib/audit'
import { assertReturnMutable, ReturnImmutableError } from '@/lib/tax/t2/assertReturnMutable'
import { buildGifi } from '@/lib/tax/t2/buildGifi'
import { pull } from '@/lib/tax/t2/pull'
import { buildT2 } from '@/lib/tax/t2/buildT2'
import { engineVersionFor } from '@/lib/tax/t2/rates'
import type { DividendKind, PulledRefs } from '@/lib/tax/t2/types'

/**
 * POST /api/tax/t2/[fyeYear]/recompute
 *
 * Re-pull the corporation's books (pull.ts — GIFI roll-up, dividends, Schedule 8,
 * the active/passive split), recompute the federal + Alberta return (buildT2), and
 * persist the refreshed line snapshot + provenance + DRIFT verdict.
 *
 * Drift: a previously-pulled line is STALE when its underlying GL/JE/CCA ids now
 * sum to a different total than the stored `pulledRefs` recorded (a new posted JE,
 * a re-categorised account, a CCA disposition). Recompute is how that drift is
 * cleared — so this route reports the drift it FOUND (against the prior stored
 * refs) and then overwrites the refs with the fresh pull, clearing it.
 *
 * Only a DRAFT can be recomputed/persisted (assertReturnMutable). A prepared
 * return must be reopened first (its resultSnapshot is frozen).
 */

function fiscalStartOf(fyeYear: number): Date {
  return new Date(Date.UTC(fyeYear, 0, 1))
}

function fiscalEndOf(fyeYear: number): Date {
  return new Date(Date.UTC(fyeYear, 11, 31))
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fyeYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { fyeYear: raw } = await params
  const fyeYear = parseInt(raw, 10)
  if (!Number.isFinite(fyeYear)) return Response.json({ error: 'Invalid fiscal year-end year' }, { status: 400 })

  const fiscalYearStart = fiscalStartOf(fyeYear)
  const fiscalYearEnd = fiscalEndOf(fyeYear)

  const ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T2 return for this fiscal year.' }, { status: 404 })

  try {
    assertReturnMutable(ret)
  } catch (e) {
    if (e instanceof ReturnImmutableError) return Response.json({ error: e.message, code: e.code }, { status: 409 })
    throw e
  }

  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  const province = (ret.provinceSnapshot || 'AB').toUpperCase()

  // Fresh pull (provenance) for the drift comparison.
  const fresh = await pull({
    taxationYear: fyeYear,
    fiscalYearStart,
    fiscalYearEnd,
    province,
    buildGifi: async () =>
      buildGifi({
        fiscalYearEnd,
        fiscalYearStart,
        retainedEarningsOpening: 0,
        dividendsDeclaredAccountId: settings?.dividendsDeclaredAccountId ?? null,
      }),
    legacyDividendKind: 'nonEligible' as DividendKind,
  })

  // Detect drift against the PRIOR stored provenance before we overwrite it: a
  // line whose total changed (ids added/removed/re-summed) since it was stored.
  const priorRefs = (ret.pulledRefs as PulledRefs | null) ?? null
  const driftLines: string[] = []
  if (priorRefs) {
    for (const [line, next] of Object.entries(fresh.pulledRefs)) {
      const prev = priorRefs[line]
      if (!prev) continue
      const idsChanged = prev.ids.join('|') !== next.ids.join('|')
      const totalChanged = Math.abs(prev.total - next.total) > 0.005
      if (idsChanged || totalChanged) driftLines.push(line)
    }
  }

  // Full recompute via the verify pipeline (pull + federal + Alberta + checks).
  const built = await buildT2(fiscalYearEnd)

  // Persist the refreshed line snapshot + provenance. This CLEARS the drift by
  // recording the fresh effective ids/totals.
  const updated = await prisma.t2Return.update({
    where: { id: ret.id },
    data: {
      lines: built.result.lines,
      pulledRefs: fresh.pulledRefs as unknown as Prisma.InputJsonValue,
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'run',
    summary: `T2 ${fyeYear} recomputed${driftLines.length ? ` (cleared drift on ${driftLines.join(', ')})` : ''}`,
    metadata: {
      driftCleared: driftLines,
      partOneTax: built.result.federal.partOneTax,
      albertaTaxPayable: built.result.alberta.albertaTaxPayable,
    },
  })

  return Response.json({
    return: { id: updated.id, status: updated.status, lines: updated.lines, pulledRefs: updated.pulledRefs },
    result: built.result,
    report: built.report,
    dividendsPaid: fresh.dividendsPaid,
    driftCleared: driftLines,
    engineVersion: engineVersionFor(fyeYear),
  })
}
