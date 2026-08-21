import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { buildGifi } from '@/lib/tax/t2/buildGifi'
import { pull } from '@/lib/tax/t2/pull'
import {
  engineVersionFor,
  isSupportedProvince,
  DEFAULT_PROVINCE,
} from '@/lib/tax/t2/rates'
import { assertReturnMutable, ReturnImmutableError } from '@/lib/tax/t2/assertReturnMutable'
import type { DividendKind, T2Lines } from '@/lib/tax/t2/types'

/**
 * T2 return per-fiscal-year resource (descriptor-driven, "Prepare & verify"
 * lifecycle). The corporate analogue of the T1 per-year route — but keyed by the
 * FISCAL-YEAR-END year (the corporation is the singleton; one return per FYE).
 *
 * v1 persona: an Alberta CCPC with a DECEMBER-31 fiscal year-end, full 12-month
 * years only. The `[fyeYear]` segment is the calendar year the FYE falls in, so
 * fiscalYearEnd = Dec 31 of that year, fiscalYearStart = Jan 1, taxationYear =
 * fyeYear.
 *
 *   GET /api/tax/t2/[fyeYear]
 *     → load-or-INIT the draft T2Return for the fiscal year. Initialising a fresh
 *       draft snapshots the corporate identity (legal name + BN/RC + province)
 *       from CompanySettings and runs the GL/CCA/dividend pull so the builder
 *       opens pre-populated (NOT persisted — the save/recompute routes own writes).
 *
 *   PUT /api/tax/t2/[fyeYear]   { linesOverride?, s141?, identity?, notes? }
 *     → save draft line overrides + Schedule-141 attestations + identity carries.
 *       Blocked once status !== 'draft' (assertReturnMutable).
 *
 * The Alberta AT1 is computed alongside the federal T2 from the same books; both
 * are surfaced by the export route. No SIN/identity-bearing artifact is persisted.
 */

function parseYear(raw: string): number {
  return parseInt(raw, 10)
}

/** UTC midnight of Jan 1 of the fiscal year (full-year persona). */
function fiscalStartOf(fyeYear: number): Date {
  return new Date(Date.UTC(fyeYear, 0, 1))
}

/** UTC date of Dec 31 of the fiscal year-end year (the canonical key). */
function fiscalEndOf(fyeYear: number): Date {
  return new Date(Date.UTC(fyeYear, 11, 31))
}

/** Coerce a JSON line-map body into a clean string→number map. */
function toLineMap(v: unknown): T2Lines {
  if (!v || typeof v !== 'object') return {}
  const out: T2Lines = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fyeYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { fyeYear: raw } = await params
  const fyeYear = parseYear(raw)
  if (!Number.isFinite(fyeYear) || fyeYear < 2000 || fyeYear > 2100) {
    return Response.json({ error: 'Invalid fiscal year-end year' }, { status: 400 })
  }

  const fiscalYearStart = fiscalStartOf(fyeYear)
  const fiscalYearEnd = fiscalEndOf(fyeYear)

  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })

  // Effective return = highest non-superseded amendmentSeq for the FYE.
  let ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })

  let created = false
  if (!ret) {
    const province = (settings?.province || DEFAULT_PROVINCE).toUpperCase()
    ret = await prisma.t2Return.create({
      data: {
        fiscalYearStart,
        fiscalYearEnd,
        taxationYear: fyeYear,
        daysInYear: 365,
        status: 'draft',
        provinceSnapshot: province,
        legalNameSnapshot: (settings?.legalName || '').trim(),
        bnRcSnapshot: (settings?.t2ProgramAccount || '').trim().toUpperCase(),
        createdById: (session.user as { id?: string }).id ?? null,
      },
    })
    created = true
    await audit({
      entityType: 'tax_return',
      entityId: ret.id,
      action: 'create',
      summary: `T2 ${fyeYear} draft initialised`,
    })
  }

  const province = (ret.provinceSnapshot || DEFAULT_PROVINCE).toUpperCase()

  // Pull the corporation's books so the builder opens pre-populated (NOT persisted).
  const pulled = await pull({
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

  return Response.json({
    created,
    return: serializeReturn(ret),
    company: {
      legalName: (settings?.legalName || '').trim(),
      bnRc: (settings?.t2ProgramAccount || '').trim().toUpperCase(),
      albertaCan: (settings?.albertaCorporateAccountNumber || '').trim(),
      province,
      dividendsDeclaredAccountConfigured: !!settings?.dividendsDeclaredAccountId,
    },
    pulled: {
      lines: pulled.lines,
      pulledRefs: pulled.pulledRefs,
      dividendsPaid: pulled.dividendsPaid,
      gifi: pulled.gifi,
      scheduleEight: pulled.scheduleEight,
      issues: pulled.issues,
    },
    engineVersion: engineVersionFor(fyeYear),
    provinceSupported: isSupportedProvince(province),
  })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ fyeYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { fyeYear: raw } = await params
  const fyeYear = parseYear(raw)
  if (!Number.isFinite(fyeYear)) return Response.json({ error: 'Invalid fiscal year-end year' }, { status: 400 })

  const fiscalYearEnd = fiscalEndOf(fyeYear)

  const body = await request.json().catch(() => ({}))

  const ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No draft T2 return for this fiscal year. Load it first.' }, { status: 404 })

  try {
    assertReturnMutable(ret)
  } catch (e) {
    if (e instanceof ReturnImmutableError) return Response.json({ error: e.message, code: e.code }, { status: 409 })
    throw e
  }

  const data: Record<string, unknown> = {}

  // Province (corporate residence snapshot) — explicit.
  if (typeof body.province === 'string' && body.province.trim()) {
    data.provinceSnapshot = body.province.trim().toUpperCase()
  }

  // Identity snapshots (editable on a draft).
  if (typeof body.legalName === 'string') data.legalNameSnapshot = body.legalName.trim()
  if (typeof body.bnRc === 'string') data.bnRcSnapshot = body.bnRc.trim().toUpperCase()

  // Manual line overrides (instalments, opt-in lines, identity carries).
  if (body.linesOverride !== undefined) {
    data.linesOverride = body.linesOverride === null ? null : toLineMap(body.linesOverride)
  }

  // Schedule 141 attestations (enums/booleans — never amounts).
  if (body.s141 !== undefined) {
    data.s141 = body.s141 === null ? null : (body.s141 as object)
  }

  if (typeof body.notes === 'string') data.notes = body.notes

  const updated = await prisma.t2Return.update({ where: { id: ret.id }, data })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'update',
    summary: `T2 ${fyeYear} draft saved`,
    metadata: { fields: Object.keys(data) },
  })

  return Response.json({ return: serializeReturn(updated) })
}

/** Serialize a T2Return for the client. */
function serializeReturn(ret: {
  id: string
  fiscalYearStart: Date
  fiscalYearEnd: Date
  taxationYear: number
  daysInYear: number
  status: string
  amendmentSeq: number
  amendsId: string | null
  legalNameSnapshot: string
  bnRcSnapshot: string
  provinceSnapshot: string
  lines: unknown
  linesOverride: unknown
  pulledRefs: unknown
  s141: unknown
  resultSnapshot: unknown
  engineVersion: string
  preparedAt: Date | null
  notes: string
  updatedAt: Date
}) {
  return {
    id: ret.id,
    fiscalYearStart: ret.fiscalYearStart.toISOString().slice(0, 10),
    fiscalYearEnd: ret.fiscalYearEnd.toISOString().slice(0, 10),
    taxationYear: ret.taxationYear,
    daysInYear: ret.daysInYear,
    status: ret.status,
    amendmentSeq: ret.amendmentSeq,
    amendsId: ret.amendsId,
    legalName: ret.legalNameSnapshot,
    bnRc: ret.bnRcSnapshot,
    province: ret.provinceSnapshot,
    lines: ret.lines ?? {},
    linesOverride: ret.linesOverride ?? null,
    pulledRefs: ret.pulledRefs ?? null,
    s141: ret.s141 ?? null,
    resultSnapshot: ret.resultSnapshot ?? null,
    engineVersion: ret.engineVersion,
    preparedAt: ret.preparedAt ? ret.preparedAt.toISOString() : null,
    notes: ret.notes,
    updatedAt: ret.updatedAt.toISOString(),
  }
}
