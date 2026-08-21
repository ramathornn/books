import React from 'react'
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer'

import { taxStyles as s } from '@/lib/tax/pdf/styles'
import { money2 } from '@/lib/tax/round'

/**
 * CCA Schedule (Schedule 8-style) — printable @react-pdf document showing, per
 * class for a tax year: opening UCC, additions, dispositions, the half-year /
 * AccII adjustment, the CCA base, rate, CCA claimed, and closing UCC. Recapture
 * (closing < 0) and terminal-loss rows are flagged. Catch-up rows (prior-period
 * corrections booked in the first open year) are labelled.
 */

export interface CcaScheduleRow {
  classNumber: string
  description: string
  openingUcc: number
  additions: number
  dispositions: number
  adjustment: number // half-year holdback (negative effect) or AccII uplift
  ccaBase: number
  ccaRate: number
  ccaClaimed: number
  closingUcc: number
  method: string
  isCatchUp?: boolean
  catchUpForYear?: number | null
  recapture?: boolean
  terminalLossPossible?: boolean
}

export interface CcaScheduleProps {
  taxYear: number
  filer: { legalName: string; bn: string; address: string }
  rows: CcaScheduleRow[]
  isDraft?: boolean
}

function pct(rate: number): string {
  return `${money2(rate * 100)}%`
}

export function CcaScheduleDocument(props: CcaScheduleProps) {
  const { taxYear, filer, rows, isDraft } = props
  const totalClaimed = rows.reduce((a, r) => a + (r.ccaClaimed || 0), 0)
  const totalClosing = rows.reduce((a, r) => a + (r.closingUcc || 0), 0)
  return (
    <Document title={`CCA Schedule ${taxYear}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>Capital Cost Allowance Schedule</Text>
            <Text style={s.subtitle}>Schedule 8 — declining balance — {taxYear}</Text>
            {isDraft ? <Text style={s.draftBadge}>DRAFT — NOT FILED</Text> : null}
          </View>
          <View style={s.companyInfo}>
            <Text style={s.companyName}>{filer.legalName}</Text>
            <Text>{filer.bn}</Text>
            <Text>{filer.address}</Text>
          </View>
        </View>
        <View style={s.separator} />

        <View style={s.tableHeader}>
          <Text style={[{ flex: 1.4 }, s.headerText]}>Class</Text>
          <Text style={[s.colAmount, s.headerText]}>Opening UCC</Text>
          <Text style={[s.colAmount, s.headerText]}>Additions</Text>
          <Text style={[s.colAmount, s.headerText]}>Dispositions</Text>
          <Text style={[s.colAmount, s.headerText]}>Adj.</Text>
          <Text style={[s.colAmount, s.headerText]}>CCA base</Text>
          <Text style={[{ width: 50, textAlign: 'right' }, s.headerText]}>Rate</Text>
          <Text style={[s.colAmount, s.headerText]}>CCA claimed</Text>
          <Text style={[s.colAmount, s.headerText]}>Closing UCC</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={s.tableRow}>
            <View style={{ flex: 1.4 }}>
              <Text style={s.cellBold}>
                {r.classNumber}
                {r.isCatchUp ? ` (catch-up${r.catchUpForYear ? ` ${r.catchUpForYear}` : ''})` : ''}
              </Text>
              <Text style={s.cellMuted}>
                {r.description} · {r.method}
                {r.recapture ? ' · RECAPTURE' : ''}
                {r.terminalLossPossible ? ' · terminal loss?' : ''}
              </Text>
            </View>
            <Text style={[s.colAmount, s.cellText]}>{money2(r.openingUcc)}</Text>
            <Text style={[s.colAmount, s.cellText]}>{money2(r.additions)}</Text>
            <Text style={[s.colAmount, s.cellText]}>{money2(r.dispositions)}</Text>
            <Text style={[s.colAmount, s.cellText]}>{money2(r.adjustment)}</Text>
            <Text style={[s.colAmount, s.cellText]}>{money2(r.ccaBase)}</Text>
            <Text style={[{ width: 50, textAlign: 'right' }, s.cellText]}>{pct(r.ccaRate)}</Text>
            <Text style={[s.colAmount, s.cellBold]}>{money2(r.ccaClaimed)}</Text>
            <Text
              style={[s.colAmount, r.closingUcc < 0 ? { fontSize: 9, color: '#C0392B' } : s.cellText]}
            >
              {money2(r.closingUcc)}
            </Text>
          </View>
        ))}

        <View style={s.tableRowTotal}>
          <Text style={[{ flex: 1.4 }, s.cellBold]}>Totals ({rows.length} classes)</Text>
          <Text style={[s.colAmount, s.cellText]} />
          <Text style={[s.colAmount, s.cellText]} />
          <Text style={[s.colAmount, s.cellText]} />
          <Text style={[s.colAmount, s.cellText]} />
          <Text style={[s.colAmount, s.cellText]} />
          <Text style={[{ width: 50 }, s.cellText]} />
          <Text style={[s.colAmount, s.cellBold]}>{money2(totalClaimed)}</Text>
          <Text style={[s.colAmount, s.cellBold]}>{money2(totalClosing)}</Text>
        </View>

        <Text style={s.note}>
          Functional working copy. CCA claimed posts a year-end journal entry (DR expense / CR accumulated
          depreciation) dated the fiscal year-end. Closing UCC = opening + additions − dispositions − CCA claimed.
          Negative closing UCC indicates recapture into income.
        </Text>
      </Page>
    </Document>
  )
}

/** Render the CCA schedule to a PDF Buffer. */
export function renderCcaSchedule(props: CcaScheduleProps): Promise<Buffer> {
  return renderToBuffer(<CcaScheduleDocument {...props} />)
}
