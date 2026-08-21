import React from 'react'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { taxStyles as s } from '@/lib/tax/pdf/styles'
import { GST34_LINES } from '@/lib/tax/descriptors/gst34'
import { money2 } from '@/lib/tax/round'

/**
 * GST34 Worksheet — printable @react-pdf document for the GST/HST return.
 *
 * There is NO transmit file for GST34 (design finding #10): output is this
 * printable line-numbered worksheet plus a read-only NETFILE entry helper in
 * the UI. Each official line (101/103/104/105/106/107/108/109) is shown with
 * its number, label, and amount; derived lines are flagged. Line 109 < 0 is a
 * refund and is rendered with a warning note.
 */

export interface Gst34WorksheetProps {
  filer: { legalName: string; bnRt: string; address: string }
  periodStart: string
  periodEnd: string
  filingFrequency: string
  lines: Record<string, number>
  isDraft?: boolean
}

export function Gst34WorksheetDocument(props: Gst34WorksheetProps) {
  const { filer, periodStart, periodEnd, filingFrequency, lines, isDraft } = props
  const line109 = lines.line109 ?? 0
  const isRefund = line109 < 0
  return (
    <Document title={`GST34 Worksheet ${periodStart}..${periodEnd}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>GST/HST Return (GST34) Worksheet</Text>
            <Text style={s.subtitle}>
              {periodStart} to {periodEnd} · {filingFrequency}
            </Text>
            {isDraft ? <Text style={s.draftBadge}>DRAFT — NOT FILED</Text> : null}
          </View>
          <View style={s.companyInfo}>
            <Text style={s.companyName}>{filer.legalName}</Text>
            <Text>{filer.bnRt}</Text>
            <Text>{filer.address}</Text>
          </View>
        </View>
        <View style={s.separator} />

        <View style={s.tableHeader}>
          <Text style={[s.colNum, s.headerText]}>Line</Text>
          <Text style={[s.colLabel, s.headerText]}>Description</Text>
          <Text style={[s.colAmount, s.headerText]}>Amount</Text>
        </View>
        {GST34_LINES.map((d) => (
          <View key={d.key} style={s.tableRow}>
            <Text style={[s.colNum, s.cellBold]}>{d.officialNumber}</Text>
            <View style={s.colLabel}>
              <Text style={s.cellText}>{d.label}</Text>
              {d.derived ? <Text style={s.cellMuted}>derived</Text> : null}
            </View>
            <Text style={[s.colAmount, d.key === 'line109' ? s.cellBold : s.cellText]}>
              {lines[d.key] !== undefined ? money2(lines[d.key]) : '—'}
            </Text>
          </View>
        ))}

        {isRefund ? (
          <Text style={s.warnNote}>
            Line 109 is negative ({money2(line109)}) — this period is a NET REFUND. Confirm before filing.
          </Text>
        ) : null}

        <Text style={s.note}>
          Worksheet only — there is no GST34 transmit file. Key Line 101/103/105/106/108/109 into CRA GST/HST
          NETFILE using the on-screen entry helper. Line 105 = 103 + 104; Line 108 = 106 + 107; Line 109 = 105 − 108.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the GST34 worksheet to a PDF Buffer. */
export function renderGst34Worksheet(props: Gst34WorksheetProps): Promise<Buffer> {
  return renderToBuffer(<Gst34WorksheetDocument {...props} />)
}
