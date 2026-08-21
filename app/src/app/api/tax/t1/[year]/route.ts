import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { encryptSin, isValidSin } from '@/lib/tax/sin'
import { partyDisplayName, partyAddressLine } from '@/lib/tax/slipService'
import { engineVersionFor, isSupportedProvince, DEFAULT_PROVINCE } from '@/lib/tax/t1/rates'
import { assertReturnMutable, ReturnImmutableError } from '@/lib/tax/t1/assertReturnMutable'
import { pullT1FromSlips } from '@/lib/tax/t1/pull'
import type { MaritalStatus, T1Lines } from '@/lib/tax/t1/types'
import { COUPLED_STATUSES } from '@/lib/tax/t1/types'

/**
 * T1 return per-year resource (descriptor-driven, "Prepare & verify" lifecycle).
 *
 *   GET /api/tax/t1/[year]?partyId=…
 *     → load-or-INIT the draft T1Return for (year, filer). Initialising a fresh
 *       draft seeds identity from the filer TaxParty (name/address/DOB) and runs
 *       the slip pull so the builder opens pre-populated. SIN is returned masked.
 *
 *   PUT /api/tax/t1/[year]   { partyId, linesOverride?, identity?, marital? }
 *     → save draft lines/overrides + identity (marital status, spouse fields).
 *       Blocked once status !== 'draft' (assertReturnMutable). Spouse SIN is
 *       AES-GCM encrypted; spouse net income is required when married/common-law
 *       only at PREPARE time (saved freely as a draft).
 *
 * The filer is identified by `partyId` (NOT SIN — AES-GCM IVs are random). The
 * province of residence comes from the FILER, never CompanySettings (SPEC item
 * 10). No SIN-bearing artifact is persisted beyond the cipher.
 */

const KNOWN_MARITAL: MaritalStatus[] = ['single', 'married', 'commonLaw', 'separated', 'divorced', 'widowed']

function parseYear(raw: string): number {
  return parseInt(raw, 10)
}

/** Coerce a JSON line-map body into a clean string→number map. */
function toLineMap(v: unknown): T1Lines {
  if (!v || typeof v !== 'object') return {}
  const out: T1Lines = {}
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = Number(raw)
    if (Number.isFinite(n)) out[k] = n
  }
  return out
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { year } = await params
  const taxYear = parseYear(year)
  if (!Number.isFinite(taxYear)) return Response.json({ error: 'Invalid year' }, { status: 400 })

  const url = new URL(request.url)
  const partyId = (url.searchParams.get('partyId') ?? '').trim()
  if (!partyId) return Response.json({ error: 'partyId is required' }, { status: 400 })

  const party = await prisma.taxParty.findUnique({ where: { id: partyId } })
  if (!party) return Response.json({ error: 'Filer (TaxParty) not found' }, { status: 404 })
  if (party.kind !== 'individual') {
    return Response.json({ error: 'A T1 filer must be an individual TaxParty.' }, { status: 400 })
  }

  // Effective return for the year = highest non-superseded amendmentSeq.
  let ret = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })

  let created = false
  if (!ret) {
    // Initialise a fresh DRAFT seeded from the filer's identity.
    const province = (party.province || DEFAULT_PROVINCE).toUpperCase()
    ret = await prisma.t1Return.create({
      data: {
        taxYear,
        province,
        status: 'draft',
        partyId,
        taxpayerNameSnapshot: partyDisplayName(party),
        taxpayerAddressSnapshot: partyAddressLine(party),
        taxpayerDobSnapshot: party.dateOfBirth ?? null,
        maritalStatus: 'single',
        createdById: (session.user as { id?: string }).id ?? null,
      },
    })
    created = true
    await audit({
      entityType: 'tax_return',
      entityId: ret.id,
      action: 'create',
      summary: `T1 ${taxYear} draft initialised for ${partyDisplayName(party)}`,
    })
  }

  // Pull the filer's effective slips so the builder opens pre-populated (does NOT
  // persist — the save/recompute routes own writes).
  const pull = await pullT1FromSlips(taxYear, partyId)

  return Response.json({
    created,
    return: serializeReturn(ret),
    filer: {
      id: party.id,
      name: partyDisplayName(party),
      sinMasked: party.sinLast3 ? `•••-••-${party.sinLast3}` : null,
      hasSin: !!party.sinCipher,
      dateOfBirth: party.dateOfBirth ? party.dateOfBirth.toISOString().slice(0, 10) : null,
      address: partyAddressLine(party),
      province: (party.province || DEFAULT_PROVINCE).toUpperCase(),
    },
    pulled: {
      lines: pull.lines,
      pulledRefs: pull.pulledRefs,
      dividends: pull.dividends,
      issues: pull.issues,
    },
    engineVersion: engineVersionFor(taxYear, ret.province),
    provinceSupported: isSupportedProvince(ret.province),
  })
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { year } = await params
  const taxYear = parseYear(year)
  if (!Number.isFinite(taxYear)) return Response.json({ error: 'Invalid year' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const partyId = String(body.partyId ?? '').trim()
  if (!partyId) return Response.json({ error: 'partyId is required' }, { status: 400 })

  const ret = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No draft T1 return for this year/filer. Load it first.' }, { status: 404 })

  try {
    assertReturnMutable(ret)
  } catch (e) {
    if (e instanceof ReturnImmutableError) return Response.json({ error: e.message, code: e.code }, { status: 409 })
    throw e
  }

  const data: Record<string, unknown> = {}

  // Province (filer's residence on Dec 31) — explicit, never inherited.
  if (typeof body.province === 'string' && body.province.trim()) {
    data.province = body.province.trim().toUpperCase()
  }

  // Identity snapshots (editable on a draft).
  if (typeof body.taxpayerNameSnapshot === 'string') data.taxpayerNameSnapshot = body.taxpayerNameSnapshot
  if (typeof body.taxpayerAddressSnapshot === 'string') data.taxpayerAddressSnapshot = body.taxpayerAddressSnapshot
  if (body.taxpayerDob !== undefined) {
    if (body.taxpayerDob === null || body.taxpayerDob === '') {
      data.taxpayerDobSnapshot = null
    } else {
      const d = new Date(String(body.taxpayerDob))
      if (Number.isNaN(d.getTime())) return Response.json({ error: 'Invalid date of birth' }, { status: 400 })
      data.taxpayerDobSnapshot = d
    }
  }

  // Marital status + spouse fields.
  if (body.maritalStatus !== undefined) {
    const ms = String(body.maritalStatus) as MaritalStatus
    if (!KNOWN_MARITAL.includes(ms)) return Response.json({ error: `Unknown marital status "${ms}"` }, { status: 400 })
    data.maritalStatus = ms
  }
  const effectiveMarital = (data.maritalStatus as MaritalStatus) ?? (ret.maritalStatus as MaritalStatus)
  const coupled = COUPLED_STATUSES.includes(effectiveMarital)

  if (body.spouseFirstName !== undefined) {
    data.spouseFirstNameSnapshot = body.spouseFirstName ? String(body.spouseFirstName).trim() : null
  }
  if (body.spouseSin !== undefined) {
    const raw = String(body.spouseSin ?? '').trim()
    if (!raw) {
      data.spouseSinCipher = null
    } else if (!isValidSin(raw)) {
      return Response.json({ error: 'Spouse SIN fails the Luhn checksum.' }, { status: 400 })
    } else {
      data.spouseSinCipher = encryptSin(raw)
    }
  }
  if (body.spouseNetIncome !== undefined) {
    if (body.spouseNetIncome === null || body.spouseNetIncome === '') {
      data.spouseNetIncome = null
    } else {
      const n = Number(body.spouseNetIncome)
      if (!Number.isFinite(n) || n < 0) return Response.json({ error: 'Spouse net income must be a non-negative number.' }, { status: 400 })
      data.spouseNetIncome = n
    }
  }
  // Not a hard block here (that's the prepare gate) but a helpful hint.
  const spouseNetMissing =
    coupled &&
    (data.spouseNetIncome === null ||
      (data.spouseNetIncome === undefined && ret.spouseNetIncome === null))

  // Manual line overrides (RRSP 20800, instalments 47600, opt-in lines, etc.).
  if (body.linesOverride !== undefined) {
    data.linesOverride = body.linesOverride === null ? null : toLineMap(body.linesOverride)
  }

  if (typeof body.notes === 'string') data.notes = body.notes

  const updated = await prisma.t1Return.update({ where: { id: ret.id }, data })

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'update',
    summary: `T1 ${taxYear} draft saved`,
    metadata: { fields: Object.keys(data) },
  })

  return Response.json({
    return: serializeReturn(updated),
    warnings: spouseNetMissing
      ? ["Spouse's net income (line 23600) is required to prepare a married/common-law return."]
      : [],
  })
}

/** Serialize a T1Return for the client — spouse SIN masked, never plaintext. */
function serializeReturn(ret: {
  id: string
  taxYear: number
  province: string
  status: string
  amendmentSeq: number
  amendsId: string | null
  partyId: string
  taxpayerNameSnapshot: string
  taxpayerSinCipher: string | null
  taxpayerAddressSnapshot: string
  taxpayerDobSnapshot: Date | null
  maritalStatus: string
  spouseFirstNameSnapshot: string | null
  spouseSinCipher: string | null
  spouseNetIncome: unknown
  lines: unknown
  linesOverride: unknown
  pulledRefs: unknown
  resultSnapshot: unknown
  engineVersion: string
  preparedAt: Date | null
  notes: string
  updatedAt: Date
}) {
  return {
    id: ret.id,
    taxYear: ret.taxYear,
    province: ret.province,
    status: ret.status,
    amendmentSeq: ret.amendmentSeq,
    amendsId: ret.amendsId,
    partyId: ret.partyId,
    taxpayerNameSnapshot: ret.taxpayerNameSnapshot,
    taxpayerAddressSnapshot: ret.taxpayerAddressSnapshot,
    taxpayerDob: ret.taxpayerDobSnapshot ? ret.taxpayerDobSnapshot.toISOString().slice(0, 10) : null,
    maritalStatus: ret.maritalStatus,
    spouseFirstName: ret.spouseFirstNameSnapshot,
    // Spouse SIN never leaves the server in plaintext (masked placeholder only).
    spouseSinMasked: ret.spouseSinCipher ? '••• (on file)' : null,
    hasSpouseSin: !!ret.spouseSinCipher,
    spouseNetIncome: ret.spouseNetIncome === null || ret.spouseNetIncome === undefined ? null : Number(ret.spouseNetIncome),
    lines: ret.lines ?? {},
    linesOverride: ret.linesOverride ?? null,
    pulledRefs: ret.pulledRefs ?? null,
    resultSnapshot: ret.resultSnapshot ?? null,
    engineVersion: ret.engineVersion,
    preparedAt: ret.preparedAt ? ret.preparedAt.toISOString() : null,
    notes: ret.notes,
    updatedAt: ret.updatedAt.toISOString(),
  }
}
