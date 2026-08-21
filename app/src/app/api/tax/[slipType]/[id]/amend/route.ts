import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { slipTypeFromSlug, descriptorFor } from '@/lib/tax/descriptors/registry'

/**
 * Amend an issued/filed slip. Append-only: insert a NEW row with the SAME
 * slipNumber, amendmentSeq+1, reportCode 'A', `amends`→prior, status 'issued';
 * flip the prior row to status 'amended' (design finding #2/#6/#7). The new
 * amendment is itself a draft of an amendment that is immediately issued (we
 * keep the slipNumber, so no allocation needed), carrying the prior recipient
 * snapshot unless overridden.
 *
 *   POST /api/tax/[slipType]/[id]/amend  { boxes?, boxesOverride?, notes? }
 *     → { slip } (the new amendment row)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slipType: string; id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType, id } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) return Response.json({ error: `Unknown slip type "${slipType}"` }, { status: 404 })

  const prior = await prisma.taxSlip.findUnique({ where: { id } })
  if (!prior || prior.type !== type) return Response.json({ error: 'Slip not found' }, { status: 404 })
  if (prior.status === 'draft') {
    return Response.json({ error: 'Drafts are edited directly, not amended.' }, { status: 400 })
  }
  if (prior.status === 'amended') {
    return Response.json({ error: 'This slip has already been amended; amend the latest revision.' }, { status: 409 })
  }
  if (prior.isCancelled || prior.status === 'cancelled') {
    return Response.json({ error: 'Cancelled slips cannot be amended.' }, { status: 409 })
  }
  if (!prior.slipNumber) {
    return Response.json({ error: 'Slip has no allocated slip number; cannot amend.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))
  const descriptor = descriptorFor(type)

  function validateBoxMap(input: unknown, fallback: unknown): Record<string, number> | { error: string } {
    if (input === undefined) return (fallback as Record<string, number>) ?? {}
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

  const boxesRes = validateBoxMap(body.boxes, prior.boxes)
  if ('error' in boxesRes) return Response.json({ error: boxesRes.error }, { status: 400 })

  let boxesOverride: Record<string, number> | null = (prior.boxesOverride as Record<string, number> | null) ?? null
  if (body.boxesOverride !== undefined) {
    if (body.boxesOverride === null) boxesOverride = null
    else {
      const r = validateBoxMap(body.boxesOverride, null)
      if ('error' in r) return Response.json({ error: r.error }, { status: 400 })
      boxesOverride = r
    }
  }

  const amendment = await prisma.$transaction(async (tx) => {
    const created = await tx.taxSlip.create({
      data: {
        type,
        taxYear: prior.taxYear,
        status: 'issued',
        reportCode: 'A',
        partyId: prior.partyId,
        recipientNameSnapshot: prior.recipientNameSnapshot,
        recipientSinCipher: prior.recipientSinCipher,
        recipientBnSnapshot: prior.recipientBnSnapshot,
        recipientAddressSnapshot: prior.recipientAddressSnapshot,
        boxes: boxesRes,
        boxesOverride: boxesOverride as never,
        currency: prior.currency,
        slipNumber: prior.slipNumber,
        amendmentSeq: prior.amendmentSeq + 1,
        amendsId: prior.id,
        sourceRef: prior.sourceRef as never,
        issuedAt: new Date(),
        notes: String(body.notes ?? prior.notes),
        createdById: (session.user as { id?: string }).id ?? null,
      },
    })
    await tx.taxSlip.update({ where: { id: prior.id }, data: { status: 'amended' } })
    return created
  })

  await audit({
    entityType: 'tax_return',
    entityId: amendment.id,
    action: 'update',
    summary: `${type} slip ${prior.slipNumber} amended (seq ${amendment.amendmentSeq})`,
    metadata: { amendsId: prior.id },
  })
  return Response.json({ slip: amendment }, { status: 201 })
}
