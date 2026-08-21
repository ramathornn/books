import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { buildFilingExport, filingKindForType } from '@/lib/tax/filing'
import { buildLiveSummary, type SlipType } from '@/lib/tax/summary'
import { storeTaxArtifact } from '@/lib/tax/storeArtifact'
import { renderT5Summary, type T5SummaryProps } from '@/lib/tax/pdf/T5Summary'
import { renderT4ASummary, type T4ASummaryProps } from '@/lib/tax/pdf/T4ASummary'

/**
 * file/[slipType] — stage a T5 / T4A information-return filing for a tax year.
 *
 * Pipeline (design §3, §4 Phase 9 file flow):
 *   1. buildFilingExport — regenerate the SIN-bearing XML in memory from the
 *      EFFECTIVE slips (tail per slipNumber, cancelled excluded) and run the
 *      full validation gate (filer identity, SIN xor BN + Luhn, intra-slip
 *      arithmetic, XSD when present-and-degrades-gracefully when absent).
 *   2. Block the stage unless the report is ok (or `acknowledgeWarnings` for the
 *      warning-only override path — finding #14). Hard errors never pass.
 *   3. Stage NON-SIN artifacts only (the functional summary worksheet PDF and a
 *      labelled "NOT transmitted" XML) into Files → Tax Slips/{year}.
 *   4. Write the as-filed TaxSlipSummary snapshot (FROZEN totals) and back-link
 *      every filed slip to it; flip the slips to `filed`.
 *   5. Persist the FilingExport row (checksum + validationReport + slipIds only;
 *      SIN-bearing XML is regenerated on authorized download).
 *
 * GET previews the same validation report without writing anything.
 */

function parseType(raw: string): SlipType | null {
  const t = raw.toUpperCase()
  return t === 'T5' || t === 'T4A' ? (t as SlipType) : null
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ slipType: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType } = await ctx.params
  const type = parseType(slipType)
  if (!type) return Response.json({ error: 'Unknown slip type' }, { status: 400 })

  const url = new URL(request.url)
  const taxYear = parseInt(url.searchParams.get('year') || '', 10)
  if (!Number.isInteger(taxYear)) return Response.json({ error: 'Invalid year' }, { status: 400 })

  const built = await buildFilingExport(type, taxYear)
  return Response.json({
    ok: built.report.ok,
    report: built.report,
    checksum: built.checksum,
    slipIds: built.slipIds,
    filer: built.filerSnapshot,
  })
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ slipType: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { slipType } = await ctx.params
  const type = parseType(slipType)
  if (!type) return Response.json({ error: 'Unknown slip type' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const taxYear = parseInt(String(body.taxYear ?? ''), 10)
  if (!Number.isInteger(taxYear)) return Response.json({ error: 'Invalid year' }, { status: 400 })

  const acknowledgeWarnings = body.acknowledgeWarnings === true
  const craSubmissionRef: string | null = body.craSubmissionRef ? String(body.craSubmissionRef) : null

  // 1. Build + validate from the effective slips.
  const built = await buildFilingExport(type, taxYear)
  const hasErrors = built.report.issues.some((i) => i.level === 'error')
  const hasWarnings = built.report.issues.some((i) => i.level === 'warning')

  if (hasErrors) {
    return Response.json(
      { error: 'Filing blocked by validation errors', report: built.report },
      { status: 422 }
    )
  }
  if (hasWarnings && !acknowledgeWarnings) {
    return Response.json(
      { error: 'Filing has warnings; acknowledge to proceed', report: built.report, needsAcknowledgement: true },
      { status: 409 }
    )
  }

  // 2. Live summary (same effective source as the filing) for the snapshot + PDF.
  const summary = await buildLiveSummary(type, taxYear)

  // 3. Stage non-SIN artifacts: functional summary worksheet PDF + labelled XML.
  let pdfStoredFileId: string | null = null
  let xmlStoredFileId: string | null = null
  try {
    const slipRows = summary.rows.map((r) => ({
      slipNumber: r.slipNumber,
      recipientName: r.recipientName,
      recipientIdMasked: r.recipientIdMasked,
      boxes: r.boxes,
    }))
    const props: T5SummaryProps & T4ASummaryProps = {
      taxYear,
      filer: summary.filer,
      slips: slipRows,
      totals: summary.totals,
      isDraft: false,
      generatedAt: new Date().toISOString(),
    }
    const pdf = type === 'T5' ? await renderT5Summary(props) : await renderT4ASummary(props)
    pdfStoredFileId = await storeTaxArtifact({
      taxYear,
      name: `${type}-Summary-${taxYear}.pdf`,
      mimeType: 'application/pdf',
      buffer: pdf,
    })

    // The XML we stage is explicitly labelled NOT transmitted; CRA filing is via
    // Internet File Transfer. SIN-bearing XML is regenerated on download, not
    // persisted as-is — but the worksheet copy here is fine to keep on file.
    const labelledXml =
      `<!-- ${type} ${taxYear} — NOT transmitted. Submit via CRA Internet File Transfer. ` +
      `checksum=${built.checksum} -->\n${built.xml}`
    xmlStoredFileId = await storeTaxArtifact({
      taxYear,
      name: `${type}-Return-${taxYear}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(labelledXml, 'utf8'),
    })
  } catch (err) {
    // Artifact staging is best-effort; the snapshot + FilingExport are the record
    // of truth. Degrade gracefully (e.g. @react-pdf font issue) without blocking.
    console.error('tax artifact staging failed:', err)
  }

  // 4 + 5. Write the as-filed snapshot, back-link slips, and the FilingExport,
  // atomically.
  const filedAt = new Date()
  const result = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.taxSlipSummary.upsert({
      where: { type_taxYear: { type, taxYear } },
      create: {
        type,
        taxYear,
        totals: summary.totals,
        totalRecipients: summary.totalRecipients,
        filerLegalNameSnapshot: summary.filer.legalName,
        filerBnRzSnapshot: summary.filer.bnRz,
        filerAddressSnapshot: summary.filer.address,
        status: 'filed',
        filedAt,
        craSubmissionRef,
        pdfStoredFileId,
        xmlStoredFileId,
      },
      update: {
        totals: summary.totals,
        totalRecipients: summary.totalRecipients,
        filerLegalNameSnapshot: summary.filer.legalName,
        filerBnRzSnapshot: summary.filer.bnRz,
        filerAddressSnapshot: summary.filer.address,
        status: 'filed',
        filedAt,
        craSubmissionRef,
        pdfStoredFileId,
        xmlStoredFileId,
      },
    })

    // Back-link the filed slips to the snapshot and flip status to filed.
    await tx.taxSlip.updateMany({
      where: { id: { in: built.slipIds } },
      data: { summaryId: snapshot.id, status: 'filed', filedAt, craSubmissionRef },
    })

    // Supersede any prior staged export for the same kind/year.
    await tx.filingExport.updateMany({
      where: { kind: filingKindForType(type), taxYear, status: 'staged' },
      data: { status: 'superseded' },
    })

    const filingExport = await tx.filingExport.create({
      data: {
        kind: filingKindForType(type),
        taxYear,
        format: 'xml',
        status: 'staged',
        slipIds: built.slipIds,
        summaryId: snapshot.id,
        checksum: built.checksum,
        validationReport: built.report as unknown as object,
        transmitterRef: null,
        storedFileId: pdfStoredFileId,
      },
    })

    return { snapshot, filingExport }
  })

  await audit({
    entityType: 'tax_return',
    entityId: result.filingExport.id,
    action: 'finish',
    summary: `Filed ${type} ${taxYear} (${summary.totalRecipients} recipient${summary.totalRecipients === 1 ? '' : 's'})`,
    metadata: {
      type,
      taxYear,
      checksum: built.checksum,
      slipCount: built.slipIds.length,
      acknowledgedWarnings: hasWarnings ? acknowledgeWarnings : false,
    },
  })

  return Response.json({
    ok: true,
    summaryId: result.snapshot.id,
    filingExportId: result.filingExport.id,
    checksum: built.checksum,
    report: built.report,
    pdfStoredFileId,
    xmlStoredFileId,
  })
}
