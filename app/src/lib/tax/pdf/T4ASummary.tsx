import React from 'react'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { taxStyles as s } from '@/lib/tax/pdf/styles'
import { T4A_BOXES } from '@/lib/tax/descriptors/t4a'
import { money2 } from '@/lib/tax/round'

/**
 * T4A Summary (T4A SUM) — functional @react-pdf document mirroring the T5
 * summary layout: filer identity, per-recipient lines (Box 048 fees for
 * services in the locked subcontractor case), and footed totals. Official
 * recipient copies are form-filled by `fillCraSlip`.
 */

export interface T4ASummarySlipRow {
  slipNumber: string | null
  recipientName: string
  recipientIdMasked: string
  boxes: Record<string, number>
}

export interface T4ASummaryProps {
  taxYear: number
  filer: { legalName: string; bnRz: string; address: string }
  slips: T4ASummarySlipRow[]
  totals: Record<string, number>
  isDraft?: boolean
  generatedAt?: string
}

export function T4ASummaryDocument(props: T4ASummaryProps) {
  const { taxYear, filer, slips, totals, isDraft } = props
  return (
    <Document title={`T4A Summary ${taxYear}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>T4A Summary</Text>
            <Text style={s.subtitle}>Statement of Pension, Retirement, Annuity & Other Income — {taxYear}</Text>
            {isDraft ? <Text style={s.draftBadge}>DRAFT — NOT FILED</Text> : null}
          </View>
          <View style={s.companyInfo}>
            <Text style={s.companyName}>{filer.legalName}</Text>
            <Text>{filer.bnRz}</Text>
            <Text>{filer.address}</Text>
          </View>
        </View>
        <View style={s.separator} />

        <Text style={s.sectionTitle}>Recipients</Text>
        <View style={s.tableHeader}>
          <Text style={[s.colNum, s.headerText]}>Slip</Text>
          <Text style={[s.colLabel, s.headerText]}>Recipient</Text>
          {T4A_BOXES.map((b) => (
            <Text key={b.key} style={[s.colAmountWide, s.headerText]}>
              {b.officialNumber}
            </Text>
          ))}
        </View>
        {slips.map((row, i) => (
          <View key={i} style={s.tableRow}>
            <Text style={[s.colNum, s.cellText]}>{row.slipNumber ?? '—'}</Text>
            <View style={s.colLabel}>
              <Text style={s.cellBold}>{row.recipientName}</Text>
              <Text style={s.cellMuted}>{row.recipientIdMasked}</Text>
            </View>
            {T4A_BOXES.map((b) => (
              <Text key={b.key} style={[s.colAmountWide, s.cellText]}>
                {row.boxes[b.key] !== undefined ? money2(row.boxes[b.key]) : '—'}
              </Text>
            ))}
          </View>
        ))}

        <View style={s.tableRowTotal}>
          <Text style={[s.colNum, s.cellBold]} />
          <Text style={[s.colLabel, s.cellBold]}>Totals ({slips.length} recipients)</Text>
          {T4A_BOXES.map((b) => (
            <Text key={b.key} style={[s.colAmountWide, s.cellBold]}>
              {totals[b.key] !== undefined ? money2(totals[b.key]) : '—'}
            </Text>
          ))}
        </View>

        <Text style={s.note}>
          Functional working copy. Box numbers: {T4A_BOXES.map((b) => `${b.officialNumber} ${b.label}`).join('; ')}.
          File the official return via CRA Internet File Transfer; this PDF is not a transmittable slip.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the T4A summary document to a PDF Buffer. */
export function renderT4ASummary(props: T4ASummaryProps): Promise<Buffer> {
  return renderToBuffer(<T4ASummaryDocument {...props} />)
}
