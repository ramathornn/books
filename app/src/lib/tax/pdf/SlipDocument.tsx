import React from 'react'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { taxStyles as s } from '@/lib/tax/pdf/styles'
import { boxesFor, type SlipType } from '@/lib/tax/descriptors/registry'
import { money2 } from '@/lib/tax/round'

/**
 * Generic FUNCTIONAL recipient-copy slip (T5 / T4A), descriptor-driven. This is
 * the graceful-degrade fallback rendered by the slip PDF route when the official
 * CRA fillable template (form-filled by `fillCraSlip`) is not installed. It is a
 * legible working copy — NOT a CRA-transmittable substitute slip — and is
 * labelled as such.
 */

const TITLES: Record<SlipType, { title: string; subtitle: string }> = {
  T5: { title: 'T5 — Statement of Investment Income', subtitle: 'État des revenus de placements' },
  T4A: {
    title: 'T4A — Statement of Pension, Retirement, Annuity & Other Income',
    subtitle: 'État du revenu de pension, de retraite, de rente ou d’autres revenus',
  },
}

export interface SlipDocumentProps {
  type: SlipType
  taxYear: number
  slipNumber: string | null
  reportCode: string
  isDraft?: boolean
  recipient: { name: string; idMasked: string; address: string }
  filer: { legalName: string; bnRz: string; address: string }
  /** effective box values (override ?? computed), keyed by box key. */
  boxes: Record<string, number>
}

export function SlipDocument(props: SlipDocumentProps) {
  const { type, taxYear, slipNumber, reportCode, isDraft, recipient, filer, boxes } = props
  const t = TITLES[type]
  const descriptors = boxesFor(type)
  const reportLabel = reportCode === 'A' ? 'AMENDED' : reportCode === 'C' ? 'CANCELLED' : 'ORIGINAL'

  return (
    <Document title={`${type} ${taxYear} ${recipient.name}`}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>{t.title}</Text>
            <Text style={s.subtitle}>
              {t.subtitle} — {taxYear}
            </Text>
            {isDraft ? <Text style={s.draftBadge}>DRAFT — NOT ISSUED</Text> : null}
          </View>
          <View style={s.companyInfo}>
            <Text style={s.companyName}>{filer.legalName}</Text>
            <Text>{filer.bnRz}</Text>
            <Text>{filer.address}</Text>
          </View>
        </View>
        <View style={s.separator} />

        <View style={s.metaGrid}>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>Slip number</Text>
            <Text style={s.metaValue}>{slipNumber ?? '—'}</Text>
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>Report code</Text>
            <Text style={s.metaValue}>{reportLabel}</Text>
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>Tax year</Text>
            <Text style={s.metaValue}>{taxYear}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Recipient</Text>
        <View style={s.metaGrid}>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>Name</Text>
            <Text style={s.metaValue}>{recipient.name}</Text>
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>SIN / BN</Text>
            <Text style={s.metaValue}>{recipient.idMasked}</Text>
          </View>
          <View style={s.metaCol}>
            <Text style={s.metaLabel}>Address</Text>
            <Text style={s.metaValue}>{recipient.address || '—'}</Text>
          </View>
        </View>

        <Text style={s.sectionTitle}>Amounts</Text>
        <View style={s.tableHeader}>
          <Text style={[s.colNum, s.headerText]}>Box</Text>
          <Text style={[s.colLabel, s.headerText]}>Description</Text>
          <Text style={[s.colAmount, s.headerText]}>Amount</Text>
        </View>
        {descriptors.map((d) => (
          <View key={d.key} style={s.tableRow}>
            <Text style={[s.colNum, s.cellBold]}>{d.officialNumber}</Text>
            <Text style={[s.colLabel, s.cellText]}>{d.label}</Text>
            <Text style={[s.colAmount, s.cellText]}>
              {boxes[d.key] !== undefined ? money2(boxes[d.key]) : '—'}
            </Text>
          </View>
        ))}

        <Text style={s.note}>
          Functional recipient copy. The official CRA fillable {type} template is not installed, so this legible
          working copy is rendered instead. File the official information return via CRA Internet File Transfer —
          this PDF is not a transmittable substitute slip.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the functional slip to a PDF Buffer. */
export function renderSlipDocument(props: SlipDocumentProps): Promise<Buffer> {
  return renderToBuffer(<SlipDocument {...props} />)
}
