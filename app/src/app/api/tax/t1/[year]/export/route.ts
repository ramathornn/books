import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { buildT1 } from '@/lib/tax/t1/buildT1'
import { t1ExportToCsv, t1ExportToText } from '@/lib/tax/t1/export'

/**
 * GET /api/tax/t1/[year]/export?partyId=…&format=json|csv|txt
 *
 * The PRIMARY "Prepare & verify" deliverable: the per-SLIP box transcription
 * sheet the owner re-keys into certified NETFILE software, plus the non-slip
 * items, plus the reconciliation cross-check block (SPEC item 3).
 *
 * The SIN-bearing export is REGENERATED IN MEMORY here (never persisted) — this
 * is the only surface where the SIN is unmasked, mirroring filing.ts's posture.
 * The route refuses to emit a clean export when verification has errors; it
 * stamps a DRAFT/PROVISIONAL flag instead so an unverified sheet can never be
 * mistaken for a checked one.
 *
 * Default format is JSON (transcriptionCards primary + reconciliationLines).
 * `csv` / `txt` return the flat printable worksheet.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { year } = await params
  const taxYear = parseInt(year, 10)
  if (!Number.isFinite(taxYear)) return Response.json({ error: 'Invalid year' }, { status: 400 })

  const url = new URL(request.url)
  const partyId = (url.searchParams.get('partyId') ?? '').trim()
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()
  if (!partyId) return Response.json({ error: 'partyId is required' }, { status: 400 })

  const ret = await prisma.t1Return.findFirst({
    where: { taxYear, partyId, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T1 return for this year/filer.' }, { status: 404 })

  // Regenerate the SIN-bearing export in memory (NEVER persisted).
  const built = await buildT1(taxYear, partyId)
  const ex = built.export
  const verified = built.report.ok

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'run',
    summary: `T1 ${taxYear} export regenerated (${format}, ${verified ? 'verified' : 'PROVISIONAL'})`,
    metadata: { format, verified, checksum: ex.checksum, status: ret.status },
  })

  const stamp = verified ? '' : '_DRAFT'
  const filename = `T1-${taxYear}-transcription${stamp}`

  if (format === 'csv') {
    const csv = t1ExportToCsv(ex)
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (format === 'txt' || format === 'text') {
    const text = t1ExportToText(ex)
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.txt"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // JSON: transcription cards PRIMARY; reconciliation lines as the cross-check.
  return Response.json(
    {
      taxYear: ex.taxYear,
      province: ex.province,
      status: ret.status,
      verified,
      // PRIMARY re-key surface.
      identification: ex.identification,
      transcriptionCards: ex.transcriptionCards,
      nonSlipItems: ex.nonSlipItems,
      // Cross-check only — NOT the primary thing to re-key.
      reconciliationLines: ex.reconciliationLines,
      result: ex.result,
      report: ex.report,
      engineVersion: ex.engineVersion,
      checksum: ex.checksum,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
