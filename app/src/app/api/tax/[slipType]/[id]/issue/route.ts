import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { slipTypeFromSlug } from '@/lib/tax/descriptors/registry'
import { allocateSlipNumber, buildRecipientSnapshot } from '@/lib/tax/slipService'

/**
 * Issue a DRAFT slip: allocate a slipNumber atomically (sequential per
 * type+taxYear, collision-safe retry against the @@unique constraint, mirroring
 * allocateEntryNumber), freeze the recipient identity snapshot, and transition
 * status draft→issued. After this the slip is immutable (assertSlipMutable);
 * corrections happen via /amend.
 *
 *   POST /api/tax/[slipType]/[id]/issue
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slipType: string; id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType, id } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) return Response.json({ error: `Unknown slip type "${slipType}"` }, { status: 404 })

  const slip = await prisma.taxSlip.findUnique({ where: { id }, include: { party: true } })
  if (!slip || slip.type !== type) return Response.json({ error: 'Slip not found' }, { status: 404 })
  if (slip.status !== 'draft') {
    return Response.json({ error: `Slip is already ${slip.status}; only drafts can be issued.` }, { status: 409 })
  }

  // Require at least one box value before issuing.
  const hasBox = slip.boxes && typeof slip.boxes === 'object' && Object.keys(slip.boxes as object).length > 0
  if (!hasBox) {
    return Response.json({ error: 'Cannot issue a slip with no box amounts. Run auto-pull first.' }, { status: 400 })
  }

  const snapshot = buildRecipientSnapshot(slip.party)

  // Allocate + transition with a collision-safe retry loop.
  let updated
  for (let attempt = 0; ; attempt++) {
    try {
      updated = await prisma.$transaction(async (tx) => {
        const slipNumber = await allocateSlipNumber(tx, type, slip.taxYear)
        return tx.taxSlip.update({
          where: { id },
          data: {
            status: 'issued',
            slipNumber,
            issuedAt: new Date(),
            ...snapshot,
          },
        })
      })
      break
    } catch (e) {
      // Unique violation on (type, taxYear, slipNumber, amendmentSeq) — a
      // concurrent writer grabbed the same number; retry once or twice.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && attempt < 4) {
        continue
      }
      throw e
    }
  }

  await audit({
    entityType: 'tax_return',
    entityId: id,
    action: 'post',
    summary: `${type} slip ${updated.slipNumber} issued for ${slip.taxYear}`,
  })
  return Response.json({ slip: updated })
}
