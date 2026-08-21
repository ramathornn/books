import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { slipTypeFromSlug } from '@/lib/tax/descriptors/registry'
import { computeT4A } from '@/lib/tax/compute/t4a'
import { computeT5, type DividendKind } from '@/lib/tax/compute/t5'

/**
 * Auto-pull preview: compute the box amounts for a recipient/year from the GL /
 * expense sources, WITHOUT writing anything. The slip UI calls this to fill the
 * draft's boxes and to surface a drift banner (sourceRef.pulledTotal vs live).
 *
 *   POST /api/tax/[slipType]/compute  { taxYear, partyId, kind? }
 *     → { boxes, sourceRef }
 *
 * T4A (locked case): Box 048 = Σ Expense + Σ BillLineItem for the party's
 * contractor-flagged vendor, scoped to the subcontractor-expense account.
 * T5: Box 10/11/12 (or 24/25/26) from the dividends-declared GL account.
 */
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

  const party = await prisma.taxParty.findUnique({
    where: { id: partyId },
    select: { id: true, vendorId: true },
  })
  if (!party) return Response.json({ error: 'Recipient (TaxParty) not found' }, { status: 404 })

  if (type === 'T4A') {
    if (!party.vendorId) {
      return Response.json(
        { error: 'This recipient is not linked to a vendor; T4A fees auto-pull from a contractor-flagged vendor.' },
        { status: 400 }
      )
    }
    const result = await computeT4A({ taxYear, vendorId: party.vendorId })
    return Response.json(result)
  }

  // T5
  const kind = (body.kind === 'eligible' ? 'eligible' : 'nonEligible') as DividendKind
  const result = await computeT5({ taxYear, kind })
  return Response.json(result)
}
