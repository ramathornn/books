import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { slipTypeFromSlug, type SlipType } from '@/lib/tax/descriptors/registry'
import { fillCraSlip } from '@/lib/tax/pdf/fillCraSlip'
import { renderSlipDocument } from '@/lib/tax/pdf/SlipDocument'
import { filerSnapshot, recipientIdMasked } from '@/lib/tax/slipService'

/**
 * Recipient-copy PDF for a slip.
 *
 * Tries the OFFICIAL CRA fillable template via `fillCraSlip` (pdf-lib, AcroForm
 * fill keyed by the descriptor box→field map). When the template is absent or
 * the fill fails — the current state until the CRA PDFs are sourced — it
 * GRACEFULLY DEGRADES to the functional @react-pdf `SlipDocument`, so the route
 * always returns a usable PDF and never crashes (design §3, graceful-degrade
 * hard rule). The fallback path is reported via the `X-Slip-Pdf-Source` header.
 *
 *   GET /api/tax/[slipType]/[id]/pdf
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slipType: string; id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType, id } = await params
  const type = slipTypeFromSlug(slipType)
  if (!type) return Response.json({ error: `Unknown slip type "${slipType}"` }, { status: 404 })

  const slip = await prisma.taxSlip.findUnique({
    where: { id },
    include: { party: { select: { sinLast3: true } } },
  })
  if (!slip || slip.type !== type) return Response.json({ error: 'Slip not found' }, { status: 404 })

  // Effective box values: override ?? computed.
  const computed = (slip.boxes ?? {}) as Record<string, number>
  const override = (slip.boxesOverride ?? null) as Record<string, number> | null
  const boxes: Record<string, number> = { ...computed }
  if (override) for (const [k, v] of Object.entries(override)) if (v !== null && v !== undefined) boxes[k] = v

  const filer = await filerSnapshot()
  const idMasked = recipientIdMasked({
    recipientSinCipher: slip.recipientSinCipher,
    recipientBnSnapshot: slip.recipientBnSnapshot,
    sinLast3: slip.party?.sinLast3,
  })

  let bytes: Uint8Array
  let source = 'functional'

  const filled = await fillCraSlip({
    type: type as SlipType,
    boxes,
    recipient: {
      name: slip.recipientNameSnapshot || '—',
      address: slip.recipientAddressSnapshot || '',
      sinDisplay: idMasked,
      businessNumber: slip.recipientBnSnapshot ?? undefined,
    },
    filer: { legalName: filer.legalName, businessNumber: filer.bnRz, address: filer.address },
    taxYear: slip.taxYear,
  })

  if (filled.ok) {
    bytes = filled.bytes
    source = 'official'
  } else {
    const buffer = await renderSlipDocument({
      type: type as SlipType,
      taxYear: slip.taxYear,
      slipNumber: slip.slipNumber,
      reportCode: slip.reportCode,
      isDraft: slip.status === 'draft',
      recipient: { name: slip.recipientNameSnapshot || '—', idMasked, address: slip.recipientAddressSnapshot || '' },
      filer,
      boxes,
    })
    bytes = new Uint8Array(buffer)
  }

  const filename = `${type}-${slip.slipNumber ?? 'draft'}-${slip.taxYear}.pdf`
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'X-Slip-Pdf-Source': source,
    },
  })
}
