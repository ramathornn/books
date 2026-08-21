import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { assertReturnMutable, ReturnImmutableError } from '@/lib/tax/t1/assertReturnMutable'
import { pullT1FromSlips } from '@/lib/tax/t1/pull'
import { buildT1 } from '@/lib/tax/t1/buildT1'
import { engineVersionFor } from '@/lib/tax/t1/rates'
import type { PulledRefs } from '@/lib/tax/t1/types'

/**
 * POST /api/tax/t1/[year]/recompute   { partyId }
 *
 * Re-pull the filer's effective slips (pull.ts; partyId-scoped, CAD-only),
 * recompute the return (compute.ts via buildT1), and persist the refreshed line
 * snapshot + provenance + DRIFT verdict.
 *
 * Drift (SPEC item 12 / gap-fix A2): a previously-pulled line is STALE when an
 * amended slip now exists at a higher effective `amendmentSeq` than the stored
 * `pulledRefs` recorded. Recompute is precisely how that drift is cleared — so
 * this route reports the drift it FOUND (against the prior stored refs) and then
 * overwrites the refs with the fresh pull, clearing it.
 *
 * Only a DRAFT can be recomputed/persisted (assertReturnMutable). A prepared
 * return must be reopened first (its resultSnapshot is frozen).
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { year } = await params
  const taxYear = parseInt(year, 10)
  if (!Number.isFinite(taxYear)) return Response.json({ error: 'Invalid year' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const partyId = String(body.partyId ?? '').trim()
  if (!partyId) return Response.json({ error: 'partyId is required' }, { status: 400 })

  const ret = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T1 return for this year/filer.' }, { status: 404 })

  try {
    assertReturnMutable(ret)
  } catch (e) {
    if (e instanceof ReturnImmutableError) return Response.json({ error: e.message, code: e.code }, { status: 409 })
    throw e
  }

  // Detect drift against the PRIOR stored provenance before we overwrite it.
  const priorRefs = (ret.pulledRefs as PulledRefs | null) ?? null
  const fresh = await pullT1FromSlips(taxYear, partyId)
  const driftLines: string[] = []
  if (priorRefs) {
    for (const [line, next] of Object.entries(fresh.pulledRefs)) {
      const prev = priorRefs[line]
      if (prev && next.amendmentSeq > prev.amendmentSeq) driftLines.push(line)
    }
  }

  // Full recompute via the verify pipeline (pull + compute + checks).
  const built = await buildT1(taxYear, partyId)

  // Persist the refreshed line snapshot + provenance. This CLEARS the drift by
  // recording the fresh effective amendmentSeqs.
  const updated = await prisma.t1Return.update({
    where: { id: ret.id },
    data: {
      lines: built.result.lines,
      pulledRefs: fresh.pulledRefs as object,
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'run',
    summary: `T1 ${taxYear} recomputed${driftLines.length ? ` (cleared drift on ${driftLines.join(', ')})` : ''}`,
    metadata: {
      driftCleared: driftLines,
      totalPayable: built.result.totalPayable,
      refund: built.result.refund,
      balanceOwing: built.result.balanceOwing,
    },
  })

  return Response.json({
    return: { id: updated.id, status: updated.status, lines: updated.lines, pulledRefs: updated.pulledRefs },
    result: built.result,
    report: built.report,
    dividends: fresh.dividends,
    driftCleared: driftLines,
    engineVersion: engineVersionFor(taxYear, ret.province),
  })
}
