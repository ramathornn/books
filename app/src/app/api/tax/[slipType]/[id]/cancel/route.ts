import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { slipTypeFromSlug } from '@/lib/tax/descriptors/registry'

/**
 * Cancel an issued/filed slip: append a NEW cancellation row carrying the same
 * slipNumber, amendmentSeq+1, reportCode 'C', `amends`→prior, isCancelled=true,
 * and flip the prior to status 'amended'. The effectiveSlips reducer then drops
 * this slipNumber from the filing set (tail is cancelled). Drafts are deleted,
 * not cancelled.
 *
 *   POST /api/tax/[slipType]/[id]/cancel  { reason? }
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
    return Response.json({ error: 'Delete drafts instead of cancelling them.' }, { status: 400 })
  }
  if (prior.isCancelled || prior.status === 'cancelled') {
    return Response.json({ error: 'Slip is already cancelled.' }, { status: 409 })
  }
  if (prior.status === 'amended') {
    return Response.json({ error: 'Cancel the latest revision, not a superseded one.' }, { status: 409 })
  }
  if (!prior.slipNumber) {
    return Response.json({ error: 'Slip has no allocated slip number; cannot cancel.' }, { status: 409 })
  }

  const body = await request.json().catch(() => ({}))

  const cancellation = await prisma.$transaction(async (tx) => {
    const created = await tx.taxSlip.create({
      data: {
        type,
        taxYear: prior.taxYear,
        status: 'cancelled',
        reportCode: 'C',
        partyId: prior.partyId,
        recipientNameSnapshot: prior.recipientNameSnapshot,
        recipientSinCipher: prior.recipientSinCipher,
        recipientBnSnapshot: prior.recipientBnSnapshot,
        recipientAddressSnapshot: prior.recipientAddressSnapshot,
        boxes: prior.boxes as never,
        boxesOverride: prior.boxesOverride as never,
        currency: prior.currency,
        slipNumber: prior.slipNumber,
        amendmentSeq: prior.amendmentSeq + 1,
        isCancelled: true,
        amendsId: prior.id,
        issuedAt: new Date(),
        notes: String(body.reason ?? prior.notes),
        createdById: (session.user as { id?: string }).id ?? null,
      },
    })
    await tx.taxSlip.update({ where: { id: prior.id }, data: { status: 'amended' } })
    return created
  })

  await audit({
    entityType: 'tax_return',
    entityId: cancellation.id,
    action: 'void',
    summary: `${type} slip ${prior.slipNumber} cancelled`,
    metadata: { amendsId: prior.id },
  })
  return Response.json({ slip: cancellation }, { status: 201 })
}
