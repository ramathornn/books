import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { audit } from '@/lib/audit'
import { buildT1 } from '@/lib/tax/t1/buildT1'
import { pullT1FromSlips } from '@/lib/tax/t1/pull'
import { engineVersionFor } from '@/lib/tax/t1/rates'

/**
 * T1 prepare / reopen — the verify-before-prepare gate (SPEC item 12).
 *
 *   POST /api/tax/t1/[year]/prepare   { partyId, acknowledgeWarnings? }
 *     → run buildT1's verify gate. If `report.ok === false` (any ERROR), refuse
 *       (status stays draft). If there are only WARNINGS, require
 *       `acknowledgeWarnings: true` to proceed. On success FREEZE the
 *       resultSnapshot + engineVersion + checksum + report and flip draft →
 *       prepared. NEVER sets a "filed" status. No SIN-bearing artifact is
 *       persisted (the export is regenerated in memory on download).
 *
 *   DELETE /api/tax/t1/[year]/prepare   { partyId }   (reopen)
 *     → flip prepared → draft so the return can be edited again. If the rate
 *       table / compute logic changed since prepare (engineVersion drift) the
 *       reopened draft MUST be recomputed + re-prepared before download; the
 *       response flags `engineVersionChanged` so the UI forces a re-prepare.
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
  const acknowledgeWarnings = body.acknowledgeWarnings === true
  if (!partyId) return Response.json({ error: 'partyId is required' }, { status: 400 })

  const ret = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T1 return for this year/filer.' }, { status: 404 })
  if (ret.status === 'prepared') {
    return Response.json({ error: 'Return is already prepared. Reopen it to make changes.', code: 'ALREADY_PREPARED' }, { status: 409 })
  }
  if (ret.status !== 'draft') {
    return Response.json({ error: `Cannot prepare a ${ret.status} return.` }, { status: 409 })
  }

  // Run the verify gate (pull + compute + checks; regenerates the in-memory
  // SIN-bearing export — we persist only checksum + report + result).
  const built = await buildT1(taxYear, partyId)
  const errors = built.report.issues.filter((i) => i.level === 'error')
  const warnings = built.report.issues.filter((i) => i.level === 'warning')

  if (errors.length > 0 || !built.report.ok) {
    return Response.json(
      { ok: false, error: 'Verification failed. Resolve the errors before marking prepared.', report: built.report, result: built.result },
      { status: 422 }
    )
  }
  if (warnings.length > 0 && !acknowledgeWarnings) {
    return Response.json(
      {
        ok: false,
        code: 'WARNINGS_UNACKNOWLEDGED',
        error: 'Acknowledge the warnings to mark the return prepared.',
        report: built.report,
        result: built.result,
      },
      { status: 409 }
    )
  }

  // Freeze. Persist the fresh provenance too so a later reopen can drift-check.
  const fresh = await pullT1FromSlips(taxYear, partyId)
  const engineVersion = engineVersionFor(taxYear, ret.province)

  const updated = await prisma.t1Return.update({
    where: { id: ret.id },
    data: {
      status: 'prepared',
      preparedAt: new Date(),
      engineVersion,
      lines: built.result.lines,
      pulledRefs: fresh.pulledRefs as object,
      resultSnapshot: {
        result: built.result,
        report: built.report,
        // checksum binds the prepared output without persisting any SIN/DOB.
        checksum: built.export.checksum,
        acknowledgedWarnings: warnings.map((w) => w.code),
      } as object,
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'finish',
    summary: `T1 ${taxYear} prepared (owing ${built.result.balanceOwing.toFixed(2)}, refund ${built.result.refund.toFixed(2)})`,
    metadata: { engineVersion, checksum: built.export.checksum, acknowledgedWarnings: warnings.map((w) => w.code) },
  })

  return Response.json({
    ok: true,
    return: { id: updated.id, status: updated.status, preparedAt: updated.preparedAt?.toISOString() ?? null, engineVersion },
    result: built.result,
    report: built.report,
    checksum: built.export.checksum,
  })
}

export async function DELETE(
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
  if (ret.status !== 'prepared') {
    return Response.json({ error: `Only a prepared return can be reopened (this one is ${ret.status}).` }, { status: 409 })
  }

  // If the engine logic / rate table changed since prepare, the reopened draft is
  // stale and must be recomputed + re-prepared before any download.
  const currentEngine = engineVersionFor(taxYear, ret.province)
  const engineVersionChanged = ret.engineVersion !== '' && ret.engineVersion !== currentEngine

  const updated = await prisma.t1Return.update({
    where: { id: ret.id },
    data: {
      status: 'draft',
      preparedAt: null,
      // Drop the frozen snapshot — it must be regenerated on the next prepare.
      resultSnapshot: Prisma.JsonNull,
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'update',
    summary: `T1 ${taxYear} reopened to draft${engineVersionChanged ? ' (engine version changed — re-prepare required)' : ''}`,
    metadata: { previousEngineVersion: ret.engineVersion, currentEngineVersion: currentEngine, engineVersionChanged },
  })

  return Response.json({
    return: { id: updated.id, status: updated.status },
    engineVersionChanged,
    previousEngineVersion: ret.engineVersion,
    currentEngineVersion: currentEngine,
    message: engineVersionChanged
      ? 'Reopened. The tax engine or rate table changed since this was prepared — recompute and re-prepare before downloading.'
      : 'Reopened to draft.',
  })
}
