import { NextRequest } from 'next/server'

import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { buildT2 } from '@/lib/tax/t2/buildT2'
import { t2ExportToCsv, t2ExportToText } from '@/lib/tax/t2/export'

/**
 * GET /api/tax/t2/[fyeYear]/export?format=json|csv|txt
 *
 * The PRIMARY "Prepare & verify" deliverable: the TWO re-key worksheets (federal
 * T2 + Alberta AT1) the owner transcribes into certified software / Alberta TRA
 * Net File, each line with provenance microcopy, plus the reconciliation
 * cross-check block + filing/balance-due dates.
 *
 * The export is REGENERATED IN MEMORY here (never persisted as a payload — only a
 * checksum is). The route refuses to emit a clean export when verification has
 * errors; it stamps a DRAFT/PROVISIONAL flag instead so an unverified worksheet
 * can never be mistaken for a checked one.
 *
 * Default format is JSON (the two worksheets + dates + reconciliation). `csv` /
 * `txt` return the flat printable worksheet.
 */

function fiscalEndOf(fyeYear: number): Date {
  return new Date(Date.UTC(fyeYear, 11, 31))
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fyeYear: string }> },
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { fyeYear: raw } = await params
  const fyeYear = parseInt(raw, 10)
  if (!Number.isFinite(fyeYear)) return Response.json({ error: 'Invalid fiscal year-end year' }, { status: 400 })

  const url = new URL(request.url)
  const format = (url.searchParams.get('format') ?? 'json').toLowerCase()

  const fiscalYearEnd = fiscalEndOf(fyeYear)

  const ret = await prisma.t2Return.findFirst({
    where: { fiscalYearEnd, status: { not: 'superseded' } },
    orderBy: { amendmentSeq: 'desc' },
  })
  if (!ret) return Response.json({ error: 'No T2 return for this fiscal year.' }, { status: 404 })

  // Regenerate the export in memory (NEVER persisted).
  const built = await buildT2(fiscalYearEnd)
  const ex = built.export
  const verified = built.report.ok

  await audit({
    entityType: 'tax_return',
    entityId: ret.id,
    action: 'run',
    summary: `T2 ${fyeYear} export regenerated (${format}, ${verified ? 'verified' : 'PROVISIONAL'})`,
    metadata: { format, verified, checksum: ex.checksum, status: ret.status },
  })

  const stamp = verified ? '' : '_DRAFT'
  const filename = `T2-AT1-${fyeYear}-rekey${stamp}`

  if (format === 'csv') {
    const csv = t2ExportToCsv(ex)
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
    const text = t2ExportToText(ex)
    return new Response(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}.txt"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // JSON: the two re-key worksheets PRIMARY; reconciliation lines as cross-check.
  return Response.json(
    {
      taxationYear: ex.taxationYear,
      province: ex.province,
      status: ret.status,
      verified,
      identification: ex.identification,
      // PRIMARY re-key surface — two worksheets (federal T2 + Alberta AT1).
      worksheets: ex.worksheets,
      dates: ex.dates,
      // Cross-check only — NOT the primary thing to re-key.
      reconciliationLines: ex.reconciliationLines,
      result: ex.result,
      report: ex.report,
      engineVersion: ex.engineVersion,
      checksum: ex.checksum,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
