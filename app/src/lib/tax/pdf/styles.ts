import { StyleSheet } from '@react-pdf/renderer'

/**
 * Shared @react-pdf styles for the Wave-3 tax documents (T5/T4A summaries,
 * GST34 worksheet, CCA schedule). Mirrors the palette/typography of the
 * existing invoice PDF (`src/lib/pdf.tsx`) so all generated documents look
 * consistent. These are FUNCTIONAL slips/worksheets — the official CRA-form
 * fill (recipient copy) is handled separately by `fillCraSlip` (pdf-lib).
 */

export const NAVY = '#1A3353'
export const DEEP_NAVY = '#001B40'
export const BLUE = '#0075DD'
export const GREEN = '#2FA84F'
export const RED = '#C0392B'
export const BORDER = '#E5E7EB'
export const SOFT_BORDER = '#F3F4F6'
export const TEXT_DARK = '#111827'
export const TEXT_MUTED = '#6B7280'

export const taxStyles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 50,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: TEXT_DARK,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: NAVY },
  subtitle: { fontSize: 10, color: TEXT_MUTED, marginTop: 2 },
  draftBadge: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: RED,
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 3,
    paddingVertical: 2,
    paddingHorizontal: 6,
    alignSelf: 'flex-start',
  },
  companyInfo: { textAlign: 'right', fontSize: 9, color: TEXT_MUTED, lineHeight: 1.5 },
  companyName: { fontFamily: 'Helvetica-Bold', color: TEXT_DARK },
  separator: { height: 2, backgroundColor: NAVY, marginVertical: 12 },

  metaGrid: { flexDirection: 'row', marginBottom: 16, marginTop: 6 },
  metaCol: { flex: 1, paddingRight: 10 },
  metaLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: BLUE, marginBottom: 3 },
  metaValue: { fontSize: 9, color: TEXT_DARK, lineHeight: 1.4 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: NAVY,
    marginTop: 14,
    marginBottom: 6,
  },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: BORDER,
    paddingBottom: 5,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: SOFT_BORDER,
    paddingVertical: 6,
  },
  tableRowTotal: {
    flexDirection: 'row',
    borderTopWidth: 1.5,
    borderTopColor: TEXT_DARK,
    paddingTop: 6,
    marginTop: 2,
  },
  headerText: { fontSize: 9, color: BLUE },
  cellText: { fontSize: 9, color: TEXT_DARK },
  cellBold: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: TEXT_DARK },
  cellMuted: { fontSize: 8, color: TEXT_MUTED },

  colNum: { width: 44, textAlign: 'left' },
  colLabel: { flex: 3, paddingRight: 8 },
  colAmount: { flex: 1, textAlign: 'right' },
  colAmountWide: { flex: 1.3, textAlign: 'right' },

  note: { fontSize: 8, color: TEXT_MUTED, marginTop: 14, lineHeight: 1.4 },
  warnNote: { fontSize: 9, color: RED, marginTop: 6, lineHeight: 1.4 },
})
