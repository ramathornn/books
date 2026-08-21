import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { Prisma } from '@/generated/prisma/client'
import { audit } from '@/lib/audit'
import { buildT2 } from '@/lib/tax/t2/buildT2'
import { buildGifi } from '@/lib/tax/t2/buildGifi'
import { pull } from '@/lib/tax/t2/pull'
import { engineVersionFor } from '@/lib/tax/t2/rates'
import type { DividendKind } from '@/lib/tax/t2/types'

/**
 * T2 prepare / reopen — the verify-before-prepare gate.
 *
 *   POST /api/tax/t2/[fyeYear]/prepare   { acknowledgeWarnings? }
 *     → run buildT2's verify gate (pull + federal + Alberta compute + checks). If
 *       `report.ok === false` (any ERROR — province, identity/BN/CAN, opening
 *       continuity, GRIP over-designation, GIFI balance gates, arithmetic) refuse
 *       (422, status stays draft). If there are only WARNINGS, require
 *       `acknowledgeWarnings: true` (409 otherwise). On success FREEZE the
 *       resultSnapshot + engineVersion + checksum + report and flip draft →
 *       prepared. Also snapshots the AS-FILED closing RDTOH/GRIP onto the
 *       continuity row so they become next year's opening. NEVER sets a "filed"
 *       status; no SIN-bearing artifact is persisted (the export regenerates in
 *       memory on download).
 *
 *   DELETE /api/tax/t2/[fyeYear]/prepare   (reopen)
 *     → flip prepared → draft so the return can be edited again. If the rate
 *       table / compute logic changed since prepare (engineVersion drift) the
 *       reopened draft MUST be recomputed + re-prepared before download; the
 *       response flags `engineVersionChanged`.
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

  const fiscalYearEnd = fiscalEndOf(fyeYear)

  const body = await request.json().catch(() => ({}))
  const acknowledgeWarnings = body.acknowledgeWarnings === true

  const ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T2 return for this fiscal year.' }, { status: 404 })
  if (ret.status === 'prepared') {
    return Response.json({ error: 'Return is already prepared. Reopen it to make changes.', code: 'ALREADY_PREPARED' }, { status: 409 })
  }
  if (ret.status !== 'draft') {
    return Response.json({ error: `Cannot prepare a ${ret.status} return.` }, { status: 409 })
  }

  // Run the verify gate (pull + federal + Alberta compute + checks; regenerates
  // the in-memory export — we persist only checksum + report + result).
  const built = await buildT2(fiscalYearEnd)
  const errors = built.report.issues.filter((i) => i.level === 'error')
  const warnings = built.report.issues.filter((i) => i.level === 'warning')

  if (errors.length > 0 || !built.report.ok) {
    return Response.json(
      { ok: false, error: 'Verification failed. Resolve the errors before marking prepared.', report: built.report, result: built.result },
      { status: 422 },
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
      { status: 409 },
    )
  }

  const engineVersion = engineVersionFor(fyeYear)
  const federal = built.result.federal

  // Persist the fresh full provenance too so a later reopen/recompute can
  // drift-check (the GIFI builder's refs cover only GIFI codes; the pull's cover
  // Schedule 8 + dividend lines as well).
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  const fresh = await pull({
    taxationYear: fyeYear,
    fiscalYearStart: fiscalStartOf(fyeYear),
    fiscalYearEnd,
    province: (ret.provinceSnapshot || 'AB').toUpperCase(),
    buildGifi: async () =>
      buildGifi({
        fiscalYearEnd,
        fiscalYearStart: fiscalStartOf(fyeYear),
        retainedEarningsOpening: 0,
        dividendsDeclaredAccountId: settings?.dividendsDeclaredAccountId ?? null,
      }),
    legacyDividendKind: 'nonEligible' as DividendKind,
  })

  const updated = await prisma.t2Return.update({
    where: { id: ret.id },
    data: {
      status: 'prepared',
      preparedAt: new Date(),
      engineVersion,
      lines: built.result.lines,
      pulledRefs: fresh.pulledRefs as unknown as Prisma.InputJsonValue,
      resultSnapshot: {
        federal: built.result.federal,
        alberta: built.result.alberta,
        result: built.result,
        report: built.report,
        checksum: built.export.checksum,
        acknowledgedWarnings: warnings.map((w) => w.code),
      } as unknown as Prisma.InputJsonValue,
    },
  })

  // Snapshot the AS-FILED closing RDTOH / GRIP onto the continuity row so they
  // become next year's opening (mirrors the CcaScheduleEntry filed-snapshot
  // pattern). Upsert the FYE row.
  await prisma.t2ContinuityBalance.upsert({
    where: { fiscalYearEnd },
    update: {
      filedClosingErdtoh: new Prisma.Decimal(federal.closingErdtoh),
      filedClosingNerdtoh: new Prisma.Decimal(federal.closingNerdtoh),
      filedClosingGrip: new Prisma.Decimal(federal.closingGrip),
      filedAt: new Date(),
    },
    create: {
      fiscalYearEnd,
      filedClosingErdtoh: new Prisma.Decimal(federal.closingErdtoh),
      filedClosingNerdtoh: new Prisma.Decimal(federal.closingNerdtoh),
      filedClosingGrip: new Prisma.Decimal(federal.closingGrip),
      filedAt: new Date(),
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'finish',
    summary: `T2 ${fyeYear} prepared (Part I ${federal.partOneTax.toFixed(2)}, AB ${built.result.alberta.albertaTaxPayable.toFixed(2)})`,
    metadata: { engineVersion, checksum: built.export.checksum, acknowledgedWarnings: warnings.map((w) => w.code) },
  })

  return Response.json({
    ok: true,
    return: { id: updated.id, status: updated.status, preparedAt: updated.preparedAt?.toISOString() ?? null, engineVersion },
    result: built.result,
    report: built.report,
    checksum: built.export.checksum,
    dates: built.export.dates,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ fyeYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { fyeYear: raw } = await params
  const fyeYear = parseInt(raw, 10)
  if (!Number.isFinite(fyeYear)) return Response.json({ error: 'Invalid fiscal year-end year' }, { status: 400 })

  const fiscalYearEnd = fiscalEndOf(fyeYear)

  const ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T2 return for this fiscal year.' }, { status: 404 })
  if (ret.status !== 'prepared') {
    return Response.json({ error: `Only a prepared return can be reopened (this one is ${ret.status}).` }, { status: 409 })
  }

  const currentEngine = engineVersionFor(fyeYear)
  const engineVersionChanged = ret.engineVersion !== '' && ret.engineVersion !== currentEngine

  const updated = await prisma.t2Return.update({
    where: { id: ret.id },
    data: {
      status: 'draft',
      preparedAt: null,
      resultSnapshot: Prisma.JsonNull,
    },
  })

  // Clear the as-filed continuity snapshot — it must be re-frozen on re-prepare.
  await prisma.t2ContinuityBalance.updateMany({
    where: { fiscalYearEnd },
    data: {
      filedClosingErdtoh: null,
      filedClosingNerdtoh: null,
      filedClosingGrip: null,
      filedAt: null,
    },
  })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'update',
    summary: `T2 ${fyeYear} reopened to draft${engineVersionChanged ? ' (engine version changed — re-prepare required)' : ''}`,
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
