import React from 'react'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { taxStyles as s } from '@/lib/tax/pdf/styles'
import { T5_BOXES } from '@/lib/tax/descriptors/t5'
import { money2 } from '@/lib/tax/round'

/**
 * T5 Summary (T5 SUM) — functional @react-pdf document: filer identity, the
 * per-recipient slip lines, and the footed box totals across the effective
 * slips. This is the worksheet/working copy; the official recipient copies are
 * form-filled by `fillCraSlip` (pdf-lib). Totals are passed in pre-footed by the
 * filing pipeline so the document never diverges from `effectiveSlipsForYear`.
 */

export interface T5SummarySlipRow {
  slipNumber: string | null
  recipientName: string
  recipientIdMasked: string // masked SIN or BN, never plaintext SIN
  boxes: Record<string, number>
}

export interface T5SummaryProps {
  taxYear: number
  filer: { legalName: string; bnRz: string; address: string }
  slips: T5SummarySlipRow[]
  totals: Record<string, number>
  isDraft?: boolean
  generatedAt?: string
}

export function T5SummaryDocument(props: T5SummaryProps) {
  const { taxYear, filer, slips, totals, isDraft } = props
  return (
    <Document title={`T5 Summary ${taxYear}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>T5 Summary</Text>
            <Text style={s.subtitle}>Statement of Investment Income — {taxYear}</Text>
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
          {T5_BOXES.map((b) => (
            <Text key={b.key} style={[s.colAmount, s.headerText]}>
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
            {T5_BOXES.map((b) => (
              <Text key={b.key} style={[s.colAmount, s.cellText]}>
                {row.boxes[b.key] !== undefined ? money2(row.boxes[b.key]) : '—'}
              </Text>
            ))}
          </View>
        ))}

        <View style={s.tableRowTotal}>
          <Text style={[s.colNum, s.cellBold]} />
          <Text style={[s.colLabel, s.cellBold]}>Totals ({slips.length} recipients)</Text>
          {T5_BOXES.map((b) => (
            <Text key={b.key} style={[s.colAmount, s.cellBold]}>
              {totals[b.key] !== undefined ? money2(totals[b.key]) : '—'}
            </Text>
          ))}
        </View>

        <Text style={s.note}>
          Functional working copy. Box numbers: {T5_BOXES.map((b) => `${b.officialNumber} ${b.label}`).join('; ')}.
          File the official return via CRA Internet File Transfer; this PDF is not a transmittable slip.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the T5 summary document to a PDF Buffer. */
export function renderT5Summary(props: T5SummaryProps): Promise<Buffer> {
  return renderToBuffer(<T5SummaryDocument {...props} />)
}
