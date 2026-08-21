import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { slipTypeFromSlug, descriptorFor } from '@/lib/tax/descriptors/registry'
import { effectiveSlipsForYear } from '@/lib/tax/effectiveSlips'

/**
 * Generic slip collection route (descriptor-driven; serves T5 and T4A alike).
 *
 *   GET  /api/tax/[slipType]?year=2025          → all slip rows for the year
 *   GET  /api/tax/[slipType]?year=2025&effective=1 → effective tail per slipNumber
 *   POST /api/tax/[slipType]  { taxYear, partyId, boxes?, notes? } → create DRAFT
 *
 * A POST creates a DRAFT only. The slipNumber, recipient snapshot, and status
 * transition happen in the issue route. Boxes may be supplied (e.g. from a prior
 * /compute call) or default to {}.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slipType: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) return Response.json({ error: `Unknown slip type "${slipType}"` }, { status: 404 })

  const url = new URL(request.url)
  const yearParam = url.searchParams.get('year')
  const taxYear = yearParam ? parseInt(yearParam, 10) : NaN

  if (url.searchParams.get('effective') === '1') {
    if (!Number.isFinite(taxYear)) return Response.json({ error: 'year is required' }, { status: 400 })
    const effective = await effectiveSlipsForYear(type, taxYear)
    return Response.json({ type, taxYear, slips: effective })
  }

  const slips = await prisma.taxSlip.findMany({
    where: { type, ...(Number.isFinite(taxYear) ? { taxYear } : {}) },
    include: { party: { select: { id: true, kind: true, firstName: true, lastName: true, businessName: true, sinLast3: true } } },
    orderBy: [{ taxYear: 'desc' }, { slipNumber: 'asc' }, { amendmentSeq: 'asc' }, { createdAt: 'asc' }],
  })
  return Response.json({ type, slips })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slipType: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) return Response.json({ error: `Unknown slip type "${slipType}"` }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const taxYear = parseInt(String(body.taxYear ?? ''), 10)
  const partyId = String(body.partyId ?? '').trim()
  if (!Number.isFinite(taxYear)) return Response.json({ error: 'taxYear is required' }, { status: 400 })
  if (!partyId) return Response.json({ error: 'partyId is required' }, { status: 400 })

  const party = await prisma.taxParty.findUnique({ where: { id: partyId } })
  if (!party) return Response.json({ error: 'Recipient (TaxParty) not found' }, { status: 404 })
  if (party.isArchived) return Response.json({ error: 'Recipient is archived' }, { status: 400 })

  // Validate any supplied boxes against the descriptor.
  const descriptor = descriptorFor(type)
  const boxes: Record<string, number> = {}
  if (body.boxes && typeof body.boxes === 'object') {
    for (const d of descriptor.boxes) {
      const raw = (body.boxes as Record<string, unknown>)[d.key]
      if (raw === undefined || raw === null || raw === '') continue
      const n = Number(raw)
      if (!Number.isFinite(n)) return Response.json({ error: `${d.label} must be a number` }, { status: 400 })
      const err = d.validate?.(n)
      if (err) return Response.json({ error: err }, { status: 400 })
      boxes[d.key] = descriptor.round(n)
    }
  }

  const slip = await prisma.taxSlip.create({
    data: {
      type,
      taxYear,
      status: 'draft',
      reportCode: 'O',
      partyId,
      recipientNameSnapshot: '', // frozen at issue
      recipientAddressSnapshot: '',
      boxes,
      sourceRef: (body.sourceRef ?? null) as never,
      notes: String(body.notes ?? ''),
      createdById: (session.user as { id?: string }).id ?? null,
    },
  })

  await audit({ entityType: 'tax_return', entityId: slip.id, action: 'create', summary: `${type} draft for ${taxYear}` })
  return Response.json({ slip }, { status: 201 })
}
