import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { slipTypeFromSlug, descriptorFor } from '@/lib/tax/descriptors/registry'
import { assertSlipMutable, SlipImmutableError } from '@/lib/tax/assertSlipMutable'

/**
 * Single-slip route.
 *   GET    → slip + party
 *   PATCH  → edit a DRAFT only (boxes / boxesOverride / notes); assertSlipMutable
 *            blocks any write to a non-draft (immutability enforced at the data
 *            layer, not just the UI — design finding #2).
 *   DELETE → delete a DRAFT only (issued slips are append-only; cancel instead).
 */

async function load(slipTypeSlug: string, id: string) {
  const type = slipTypeFromSlug(slipTypeSlug)
  if (!type) return { error: `Unknown slip type "${slipTypeSlug}"`, status: 404 as const }
  const slip = await prisma.taxSlip.findUnique({
    where: { id },
    include: { party: true },
  })
  if (!slip || slip.type !== type) return { error: 'Slip not found', status: 404 as const }
  return { type, slip }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slipType: string; id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { slipType, id } = await params
  const r = await load(slipType, id)
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status })
  return Response.json({ slip: r.slip })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slipType: string; id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { slipType, id } = await params
  const r = await load(slipType, id)
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status })

  try {
    assertSlipMutable(r.slip)
  } catch (e) {
    if (e instanceof SlipImmutableError) return Response.json({ error: e.message, code: e.code }, { status: 409 })
    throw e
  }

  const body = await request.json().catch(() => ({}))
  const descriptor = descriptorFor(r.type)

  const data: Record<string, unknown> = {}

  function validateBoxMap(input: unknown): Record<string, number> | { error: string } {
    const out: Record<string, number> = {}
    if (!input || typeof input !== 'object') return out
    for (const d of descriptor.boxes) {
      const raw = (input as Record<string, unknown>)[d.key]
      if (raw === undefined || raw === null || raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) return { error: `${d.label} must be a number` }
      const err = d.validate?.(n)
      if (err) return { error: err }
      out[d.key] = descriptor.round(n)
    }
    return out
  }

  if (body.boxes !== undefined) {
    const res = validateBoxMap(body.boxes)
    if ('error' in res) return Response.json({ error: res.error }, { status: 400 })
    data.boxes = res
  }
  if (body.boxesOverride !== undefined) {
    if (body.boxesOverride === null) {
      data.boxesOverride = null
    } else {
      const res = validateBoxMap(body.boxesOverride)
      if ('error' in res) return Response.json({ error: res.error }, { status: 400 })
      data.boxesOverride = res
    }
  }
  if (body.notes !== undefined) data.notes = String(body.notes)
  if (body.sourceRef !== undefined) data.sourceRef = (body.sourceRef ?? null) as never
  if (body.partyId !== undefined) {
    const partyId = String(body.partyId).trim()
    const party = await prisma.taxParty.findUnique({ where: { id: partyId } })
    if (!party) return Response.json({ error: 'Recipient not found' }, { status: 404 })
    data.partyId = partyId
  }

  const updated = await prisma.taxSlip.update({ where: { id }, data })
  await audit({ entityType: 'tax_return', entityId: id, action: 'update', summary: `${r.type} draft edited` })
  return Response.json({ slip: updated })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ slipType: string; id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { slipType, id } = await params
  const r = await load(slipType, id)
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status })

  try {
    assertSlipMutable(r.slip)
  } catch (e) {
    if (e instanceof SlipImmutableError) return Response.json({ error: e.message, code: e.code }, { status: 409 })
    throw e
  }

  await prisma.taxSlip.delete({ where: { id } })
  await audit({ entityType: 'tax_return', entityId: id, action: 'delete', summary: `${r.type} draft deleted` })
  return Response.json({ ok: true })
}
