import React from 'react'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { taxStyles as s } from '@/lib/tax/pdf/styles'
import { money2 } from '@/lib/tax/round'
import type {
  FilingDates,
  ReKeyWorksheet,
  T2Export,
  T2ExportIdentification,
} from '@/lib/tax/t2/types'

/**
 * T2 / AT1 re-key worksheet — the printable @react-pdf form of the PRIMARY
 * "Prepare & verify" deliverable. The app can NEVER transmit a T2 or an AT1, so
 * the output is TWO worksheets the owner re-keys into certified software:
 *   - page 1: the FEDERAL T2 worksheet (GIFI carries, Schedule 1/3/7/8, Part I/IV,
 *     RDTOH, dividend refund, GRIP), and
 *   - page 2: the ALBERTA AT1 worksheet (068, AB SBD, 070/072, allocation, IEG).
 *
 * Each line shows its certified-software line number, label, amount, and the
 * provenance microcopy from the export ("from GIFI 9999", "Σ Schedule 8"). The
 * federal T2 + Alberta AT1 are deliberately SEPARATE pages (separate forms filed
 * to CRA and Alberta TRA respectively). When verification failed (`report.ok =
 * false`) every page carries a PROVISIONAL/DRAFT badge so an unverified sheet can
 * never be mistaken for a checked one.
 *
 * Reuses `taxStyles` + `money2`; the Schedule 8 per-class CCA detail is rendered
 * by the existing `CcaSchedule.tsx` (Schedule 8 PDF) as a companion document.
 */

export interface T2WorksheetProps {
  identification: T2ExportIdentification
  worksheets: ReKeyWorksheet[]
  dates: FilingDates
  engineVersion: string
  checksum: string
  /** false ⇒ verification failed; stamp every page PROVISIONAL. */
  verified: boolean
}

/** A header block repeated atop each worksheet page. */
function PageHeader(props: {
  title: string
  subtitle: string
  id: T2ExportIdentification
  dates: FilingDates
  verified: boolean
}) {
  const { title, subtitle, id, dates, verified } = props
  return (
    <View>
      <View style={s.header}>
        <View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{subtitle}</Text>
          {verified ? null : <Text style={s.draftBadge}>PROVISIONAL — VERIFICATION FAILED</Text>}
        </View>
        <View style={s.companyInfo}>
          <Text style={s.companyName}>{id.legalName || '(unset)'}</Text>
          <Text>BN+RC: {id.bnRc || '(unset)'}</Text>
          {id.albertaCan ? <Text>Alberta CAN: {id.albertaCan}</Text> : null}
          <Text>
            FY {id.fiscalYearStart} → {id.fiscalYearEnd}
          </Text>
        </View>
      </View>
      <View style={s.separator} />
      <View style={s.metaGrid}>
        <View style={s.metaCol}>
          <Text style={s.metaLabel}>Filing due</Text>
          <Text style={s.metaValue}>{dates.filingDue} (FYE + 6 months)</Text>
        </View>
        <View style={s.metaCol}>
          <Text style={s.metaLabel}>Balance due</Text>
          <Text style={s.metaValue}>{dates.balanceDue} (FYE + 3 months)</Text>
        </View>
        <View style={s.metaCol}>
          <Text style={s.metaLabel}>Province</Text>
          <Text style={s.metaValue}>{id.province}</Text>
        </View>
      </View>
    </View>
  )
}

/** One worksheet page (federal T2 or Alberta AT1). */
function WorksheetPage(props: {
  ws: ReKeyWorksheet
  id: T2ExportIdentification
  dates: FilingDates
  verified: boolean
  footer: string
}) {
  const { ws, id, dates, verified, footer } = props
  const isFederal = ws.form === 'T2'
  const subtitle = isFederal
    ? 'Re-key into CRA-certified T2 software (Corporation Internet Filing)'
    : 'Re-key into Alberta TRA Net File (filed separately from the federal T2)'

  return (
    <Page size="A4" style={s.page}>
      <PageHeader title={ws.title} subtitle={subtitle} id={id} dates={dates} verified={verified} />

      <View style={s.tableHeader}>
        <Text style={[s.colNum, s.headerText]}>Line</Text>
        <Text style={[s.colLabel, s.headerText]}>Description</Text>
        <Text style={[s.colAmountWide, s.headerText]}>Amount</Text>
      </View>
      {ws.lines.map((l, i) => (
        <View key={`${l.line}-${i}`} style={s.tableRow}>
          <Text style={[s.colNum, s.cellBold]}>{l.line}</Text>
          <View style={s.colLabel}>
            <Text style={s.cellText}>{l.label}</Text>
            <Text style={s.cellMuted}>{l.provenance}</Text>
          </View>
          <Text style={[s.colAmountWide, s.cellText]}>{money2(l.amount)}</Text>
        </View>
      ))}

      <Text style={s.note}>
        This is NOT a filed return. {isFederal
          ? 'Transcribe the line numbers above into certified T2 software, then confirm the software agrees before filing.'
          : 'Alberta is outside the federal tax-collection agreement — the AT1 carries no RDTOH / Part IV / dividend-refund / GRIP and is filed to Alberta TRA, separately from the federal T2.'}
      </Text>
      <Text style={s.note}>{footer}</Text>
    </Page>
  )
}

export function T2WorksheetDocument(props: T2WorksheetProps) {
  const { identification, worksheets, dates, engineVersion, checksum, verified } = props
  const footer = `Engine ${engineVersion} · checksum ${checksum.slice(0, 16)}… · ${verified ? 'VERIFIED' : 'PROVISIONAL — resolve errors before re-keying'}`
  // Stable order: federal T2 first, Alberta AT1 second.
  const ordered = [...worksheets].sort((a, b) => (a.form === 'T2' ? -1 : 1) - (b.form === 'T2' ? -1 : 1))
  return (
    <Document title={`T2 / AT1 re-key worksheet ${identification.fiscalYearEnd}`}>
      {ordered.map((ws) => (
        <WorksheetPage
          key={ws.form}
          ws={ws}
          id={identification}
          dates={dates}
          verified={verified}
          footer={footer}
        />
      ))}
    </Document>
  )
}

/** Render the T2 / AT1 re-key worksheet to a PDF Buffer (both forms, 2 pages). */
export function renderT2Worksheet(ex: T2Export): Promise<Buffer> {
  return renderToBuffer(
    <T2WorksheetDocument
      identification={ex.identification}
      worksheets={ex.worksheets}
      dates={ex.dates}
      engineVersion={ex.engineVersion}
      checksum={ex.checksum}
      verified={ex.report.ok}
    />,
  )
}

/**
 * Map a `T2Result`'s Schedule 8 rows into the existing CcaSchedule.tsx PDF props
 * (the Schedule 8 companion document). Kept here so the export layer owns the
 * S8 → PDF projection and `CcaSchedule.tsx` stays a generic CCA renderer.
 */
export function scheduleEightCcaRows(
  rows: T2Export['result']['scheduleEight']['rows'],
): Array<{
  classNumber: string
  description: string
  openingUcc: number
  additions: number
  dispositions: number
  adjustment: number
  ccaBase: number
  ccaRate: number
  ccaClaimed: number
  closingUcc: number
  method: string
  recapture?: boolean
  terminalLossPossible?: boolean
}> {
  return rows.map((r) => ({
    classNumber: r.classNumber,
    description: r.description,
    openingUcc: r.openingUcc,
    additions: r.additions,
    dispositions: r.dispositions,
    // The half-year holdback nets against the AccII uplift for the "Adj." column.
    adjustment: r.acciiAddition - r.halfYearAdjustment,
    ccaBase: r.ccaBase,
    ccaRate: r.ccaRate,
    ccaClaimed: r.ccaClaimed,
    closingUcc: r.closingUcc,
    method: r.method,
    recapture: r.recapture,
    terminalLossPossible: r.terminalLoss,
  }))
}
