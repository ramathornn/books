import React from 'react'
import path from 'node:path'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  renderToBuffer,
} from '@react-pdf/renderer'
import { getCompanySettings, type CompanyInfo } from '@/lib/company'

// Match the app UI font (next/font IBM Plex Sans) so PDFs read like the portal.
const fontDir = path.join(process.cwd(), 'public', 'fonts')
Font.register({
  family: 'Plex',
  fonts: [
    { src: path.join(fontDir, 'IBMPlexSans-Regular.ttf'), fontWeight: 400 },
    { src: path.join(fontDir, 'IBMPlexSans-Medium.ttf'), fontWeight: 500 },
    { src: path.join(fontDir, 'IBMPlexSans-SemiBold.ttf'), fontWeight: 600 },
    { src: path.join(fontDir, 'IBMPlexSans-Bold.ttf'), fontWeight: 700 },
  ],
})
// PDF text shouldn't hyphen-break words like the default engine does.
Font.registerHyphenationCallback((word) => [word])

const NAVY = '#1A3353'
const DEEP_NAVY = '#001B40'
const BLUE = '#0075DD'
const GREEN = '#2FA84F'
const BORDER = '#E5E7EB'
const SOFT_BORDER = '#F3F4F6'
const TEXT_DARK = '#111827'
const TEXT_MUTED = '#6B7280'

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 50,
    paddingHorizontal: 55,
    fontFamily: 'Plex',
    fontSize: 10,
    color: TEXT_DARK,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  logoBlock: {
    flexDirection: 'column',
  },
  logoLine: {
    fontSize: 22,
    fontWeight: 600,
    color: NAVY,
    letterSpacing: 0.5,
    lineHeight: 1,
  },
  companyInfo: {
    textAlign: 'right',
    fontSize: 9,
    color: TEXT_MUTED,
    lineHeight: 1.5,
  },
  companyName: {
    fontWeight: 600,
    color: TEXT_DARK,
  },

  // 4-column meta grid
  metaGrid: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  metaCol: {
    flex: 1,
    paddingRight: 8,
  },
  metaColLast: {
    flex: 1,
    paddingRight: 0,
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: BLUE,
    marginBottom: 3,
  },
  metaLabelSpaced: {
    fontSize: 9,
    fontWeight: 600,
    color: BLUE,
    marginTop: 10,
    marginBottom: 3,
  },
  metaValueBold: {
    fontSize: 10,
    fontWeight: 600,
    color: TEXT_DARK,
  },
  metaValue: {
    fontSize: 9,
    color: TEXT_DARK,
    lineHeight: 1.4,
  },
  metaValueMuted: {
    fontSize: 9,
    color: TEXT_MUTED,
    lineHeight: 1.4,
  },
  amountDueValue: {
    fontSize: 22,
    fontWeight: 600,
    color: DEEP_NAVY,
  },

  // Gradient approximation: solid navy bar (react-pdf has no real gradients)
  separator: {
    height: 2,
    backgroundColor: NAVY,
    marginVertical: 14,
  },

  // Line items
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: BORDER,
    paddingBottom: 6,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
    paddingVertical: 10,
  },
  colDescription: { flex: 3, paddingRight: 10 },
  colRate: { flex: 1, textAlign: 'right', paddingRight: 10 },
  colQty: { flex: 0.6, textAlign: 'right', paddingRight: 10 },
  colTotal: { flex: 1, textAlign: 'right' },
  headerText: {
    fontSize: 9,
    color: BLUE,
  },
  cellTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: TEXT_DARK,
  },
  cellSub: {
    fontSize: 8.5,
    color: TEXT_MUTED,
    marginTop: 2.5,
    lineHeight: 1.5,
  },
  cellText: {
    fontSize: 10,
    color: TEXT_DARK,
  },
  taxChip: {
    alignSelf: 'flex-end',
    backgroundColor: '#DBEAFE',
    color: '#1D4ED8',
    fontSize: 7.5,
    fontWeight: 500,
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    marginTop: 3,
  },

  // Totals
  totalsWrap: {
    alignItems: 'flex-end',
    marginTop: 12,
  },
  totalsBox: {
    width: 240,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  totalsBorder: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 6,
    marginTop: 2,
  },
  totalsBorderBold: {
    borderTopWidth: 1.5,
    borderTopColor: TEXT_DARK,
    paddingTop: 6,
    marginTop: 2,
  },
  totalsLabel: {
    fontSize: 10,
    color: TEXT_MUTED,
  },
  totalsValue: {
    fontSize: 10,
    color: TEXT_DARK,
  },
  totalsStrong: {
    fontSize: 10,
    fontWeight: 600,
    color: TEXT_DARK,
  },
  totalsFinalLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: BLUE,
  },

  // Notes & Terms
  notesBlock: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 14,
  },
  termsBlock: {
    marginTop: 12,
  },
  notesLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: GREEN,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  notesText: {
    fontSize: 9,
    color: '#374151',
    lineHeight: 1.5,
  },
})

interface LineItemData {
  title: string
  description?: string
  rate: number
  quantity: number
  lineTotal: number
  taxCodes?: string[]
}

interface ClientData {
  clientName?: string
  organization?: string
  address?: string
  vatId?: string
}

export interface InvoicePdfData {
  type: 'invoice'
  invoiceNumber: string
  reference?: string
  dateIssued: Date | string
  dateDue?: Date | string | null
  currency: string
  subtotal: number
  discount?: number
  taxTotal: number
  total: number
  amountPaid: number
  amountDue: number
  notes?: string
  terms?: string
  client: ClientData
  lineItems: LineItemData[]
  company?: CompanyInfo
}

export interface EstimatePdfData {
  type: 'estimate'
  estimateNumber: string
  dateIssued: Date | string
  currency: string
  subtotal: number
  taxTotal: number
  total: number
  notes?: string
  client: ClientData
  lineItems: LineItemData[]
  company?: CompanyInfo
}

export type PdfData = InvoicePdfData | EstimatePdfData

type PdfDataWithCompany = PdfData & { company: CompanyInfo }

function splitCompanyName(name: string): string[] {
  const upper = name.toUpperCase()
  const idx = upper.indexOf(' ')
  if (idx === -1) return [upper]
  return [upper.slice(0, idx), upper.slice(idx + 1)]
}

function formatNum(n: number): string {
  return Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function getCurrencySymbol(currency: string): string {
  return currency === 'EUR' ? '\u20ac' : '$'
}

// "GST:5" -> "GST 5%", bare "GST" -> "GST"
function formatTaxCode(code: string): string {
  const [name, rate] = code.split(':')
  return rate ? `${name} ${rate}%` : name
}

function stripCountry(address: string): string {
  return address
    .split('\n')
    .filter(
      (line) =>
        !/^(canada|united states|usa|us)$/i.test(line.trim())
    )
    .join('\n')
}

function InvoicePageContent({ data }: { data: PdfDataWithCompany }) {
  const isInvoice = data.type === 'invoice'
  const sym = getCurrencySymbol(data.currency)
  const company = data.company
  const logoLines = splitCompanyName(company.name)

  const docNumber = isInvoice
    ? (data as InvoicePdfData).invoiceNumber
    : (data as EstimatePdfData).estimateNumber

  const amountDisplay = isInvoice
    ? (data as InvoicePdfData).amountDue
    : data.total

  const reference = isInvoice ? (data as InvoicePdfData).reference : undefined
  const dateDue = isInvoice ? (data as InvoicePdfData).dateDue : undefined
  const discount = isInvoice ? (data as InvoicePdfData).discount ?? 0 : 0
  const amountPaid = isInvoice ? (data as InvoicePdfData).amountPaid : 0

  const addressLines = data.client.address
    ? stripCountry(data.client.address).split('\n').filter(Boolean)
    : []

  // Mirror the portal's totals label: "Tax (GST 5%)" from the applied codes
  const uniqueTaxCodes = Array.from(
    new Set(data.lineItems.flatMap((li) => li.taxCodes ?? []))
  )
  const taxLabel =
    uniqueTaxCodes.length > 0
      ? `Tax (${uniqueTaxCodes.map(formatTaxCode).join(', ')})`
      : 'Tax'

  return (
    <Page size="A4" style={styles.page}>
        {/* Header: stacked company name + business address */}
        <View style={styles.header}>
          <View style={styles.logoBlock}>
            {logoLines.map((line, i) => (
              <Text key={i} style={styles.logoLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={styles.companyInfo}>
            <Text style={styles.companyName}>{company.legalName}</Text>
            {company.phone ? <Text>{company.phone}</Text> : null}
            {company.addressMultiLine.map((line, i) => (
              <Text key={i}>{line}</Text>
            ))}
          </View>
        </View>

        {/* 4-column meta grid */}
        <View style={styles.metaGrid}>
          {/* Col 1: Billed To */}
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>
              {isInvoice ? 'Billed To' : 'Prepared For'}
            </Text>
            {data.client.organization ? (
              <>
                <Text style={styles.metaValueBold}>{data.client.organization}</Text>
                {data.client.clientName ? (
                  <Text style={styles.metaValueMuted}>{data.client.clientName}</Text>
                ) : null}
              </>
            ) : (
              <Text style={styles.metaValueBold}>
                {data.client.clientName || 'Client'}
              </Text>
            )}
            {addressLines.map((line, i) => (
              <Text key={i} style={styles.metaValueMuted}>
                {line}
              </Text>
            ))}
          </View>

          {/* Col 2: Date of Issue / Due Date / VAT */}
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>
              {isInvoice ? 'Date of Issue' : 'Estimate Date'}
            </Text>
            <Text style={styles.metaValue}>{formatDate(data.dateIssued)}</Text>
            {isInvoice && dateDue ? (
              <>
                <Text style={styles.metaLabelSpaced}>Due Date</Text>
                <Text style={styles.metaValue}>{formatDate(dateDue)}</Text>
              </>
            ) : null}
            {data.client.vatId ? (
              <>
                <Text style={styles.metaLabelSpaced}>VAT ID</Text>
                <Text style={styles.metaValue}>{data.client.vatId}</Text>
              </>
            ) : null}
          </View>

          {/* Col 3: Invoice Number / Reference */}
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>
              {isInvoice ? 'Invoice Number' : 'Estimate Number'}
            </Text>
            <Text style={styles.metaValue}>{docNumber}</Text>
            {isInvoice ? (
              <>
                <Text style={styles.metaLabelSpaced}>Reference</Text>
                <Text style={styles.metaValue}>{reference || '\u2014'}</Text>
              </>
            ) : null}
          </View>

          {/* Col 4: Amount Due */}
          <View style={styles.metaColLast}>
            <Text style={styles.metaLabel}>
              {isInvoice ? `Amount Due (${data.currency})` : `Total (${data.currency})`}
            </Text>
            <Text style={styles.amountDueValue}>
              {sym} {formatNum(amountDisplay)}
            </Text>
          </View>
        </View>

        {/* Navy → green separator (solid bar approximation) */}
        <View style={styles.separator} />

        {/* Line items */}
        <View style={styles.tableHeader}>
          <View style={styles.colDescription}>
            <Text style={styles.headerText}>Description</Text>
          </View>
          <View style={styles.colRate}>
            <Text style={styles.headerText}>Rate</Text>
          </View>
          <View style={styles.colQty}>
            <Text style={styles.headerText}>Qty</Text>
          </View>
          <View style={styles.colTotal}>
            <Text style={styles.headerText}>Line Total</Text>
          </View>
        </View>

        {data.lineItems.map((item, i) => (
          <View key={i} style={styles.tableRow}>
            <View style={styles.colDescription}>
              <Text style={styles.cellTitle}>{item.title}</Text>
              {item.description ? (
                <Text style={styles.cellSub}>{item.description}</Text>
              ) : null}
            </View>
            <View style={styles.colRate}>
              <Text style={styles.cellText}>
                {sym} {formatNum(item.rate)}
              </Text>
              {item.taxCodes && item.taxCodes.length > 0 ? (
                <Text style={styles.taxChip}>
                  {item.taxCodes.map(formatTaxCode).join(', ')}
                </Text>
              ) : null}
            </View>
            <View style={styles.colQty}>
              <Text style={styles.cellText}>{item.quantity}</Text>
            </View>
            <View style={styles.colTotal}>
              <Text style={styles.cellText}>
                {sym} {formatNum(item.lineTotal)}
              </Text>
            </View>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatNum(data.subtotal)}</Text>
            </View>
            {discount > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Discount</Text>
                <Text style={styles.totalsValue}>-{formatNum(discount)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{taxLabel}</Text>
              <Text style={styles.totalsValue}>{formatNum(data.taxTotal)}</Text>
            </View>
            <View style={[styles.totalsRow, styles.totalsBorder]}>
              <Text style={styles.totalsStrong}>Total</Text>
              <Text style={styles.totalsStrong}>{formatNum(data.total)}</Text>
            </View>
            {isInvoice ? (
              <>
                <View style={styles.totalsRow}>
                  <Text style={styles.totalsLabel}>Amount Paid</Text>
                  <Text style={styles.totalsValue}>{formatNum(amountPaid)}</Text>
                </View>
                <View style={[styles.totalsRow, styles.totalsBorderBold]}>
                  <Text style={styles.totalsFinalLabel}>
                    Amount Due ({data.currency})
                  </Text>
                  <Text style={styles.totalsStrong}>
                    {sym} {formatNum((data as InvoicePdfData).amountDue)}
                  </Text>
                </View>
              </>
            ) : null}
          </View>
        </View>

        {/* Notes */}
        {data.notes ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesLabel}>Notes</Text>
            <Text style={styles.notesText}>{data.notes}</Text>
          </View>
        ) : null}

        {/* Terms */}
        {(data as { terms?: string }).terms ? (
          <View style={styles.termsBlock}>
            <Text style={styles.notesLabel}>Terms</Text>
            <Text style={styles.notesText}>
              {(data as { terms?: string }).terms}
            </Text>
          </View>
        ) : null}
      </Page>
  )
}

function InvoiceEstimatePdf({ data }: { data: PdfDataWithCompany }) {
  return (
    <Document>
      <InvoicePageContent data={data} />
    </Document>
  )
}

function BulkPdf({ items }: { items: PdfDataWithCompany[] }) {
  return (
    <Document>
      {items.map((d, i) => (
        <InvoicePageContent key={i} data={d} />
      ))}
    </Document>
  )
}

export async function generatePdf(data: PdfData): Promise<Buffer> {
  const company = data.company ?? (await getCompanySettings())
  const buffer = await renderToBuffer(
    <InvoiceEstimatePdf data={{ ...data, company }} />
  )
  return Buffer.from(buffer)
}

export async function generateBulkPdf(items: PdfData[]): Promise<Buffer> {
  const company = await getCompanySettings()
  const withCompany: PdfDataWithCompany[] = items.map((d) => ({ ...d, company }))
  const buffer = await renderToBuffer(<BulkPdf items={withCompany} />)
  return Buffer.from(buffer)
}
