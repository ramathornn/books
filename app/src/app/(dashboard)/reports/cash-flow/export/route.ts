import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { auth } from '@/lib/auth'
import { formatCsv } from '@/lib/csv'
import { resolveReportRange, resolveCustomReportRange } from '@/lib/reportRange'
import { getCompanySettings } from '@/lib/company'
import { computeCashFlowFromGL, type CashFlowRow } from '@/lib/reports/cashFlow'

/**
 * Statement of Cash Flows export (?format=csv | xlsx, default csv) for the
 * requested range (?preset= or ?start=&end=). Indirect method, GL-derived,
 * CAD, accrual — there is no basis or currency selector to honour, so any
 * ?basis / ?currency / ?tab params ReportLayout's download() forwards are
 * ignored.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const preset = sp.get('preset') || 'this-year'
  const format = sp.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const company = await getCompanySettings()
  const range =
    resolveCustomReportRange(sp.get('start') ?? undefined, sp.get('end') ?? undefined) ??
    resolveReportRange(preset, undefined, company.fiscalYearEnd)

  const s = await computeCashFlowFromGL(range.start, range.end)
  const money = (n: number) => Math.round(n * 100) / 100
  const fmt = (r: CashFlowRow) => `${r.accountName} (${r.accountNumber})`

  const headers = ['', 'Amount']
  const rows: Array<Array<string | number>> = [
    ['OPERATING ACTIVITIES', ''],
    ['Net income', money(s.netIncome)],
    ...s.depreciationRows.map((r) => [fmt(r), money(r.amount)]),
    ...s.operatingRows.map((r) => [fmt(r), money(r.amount)]),
    ['Net cash provided by (used in) operating activities', money(s.operatingTotal)],
    ['INVESTING ACTIVITIES', ''],
    ...s.investingRows.map((r) => [fmt(r), money(r.amount)]),
    ['Net cash provided by (used in) investing activities', money(s.investingTotal)],
    ['FINANCING ACTIVITIES', ''],
    ...s.financingRows.map((r) => [fmt(r), money(r.amount)]),
    ['Net cash provided by (used in) financing activities', money(s.financingTotal)],
    ['Net increase (decrease) in cash', money(s.netCashChange)],
    ['Cash at beginning of period', money(s.cashAtStart)],
    ['Cash at end of period', money(s.cashAtEnd)],
  ]

  // Boundaries and entry dates are UTC calendar-date instants (lib/reportRange),
  // so the UTC date IS the calendar date.
  const dateLabel = (d: Date) => d.toISOString().slice(0, 10)
  const basename = `cash-flow-${dateLabel(range.start)}-${dateLabel(range.end)}`

  const boldLabels = new Set([
    'OPERATING ACTIVITIES',
    'INVESTING ACTIVITIES',
    'FINANCING ACTIVITIES',
    'Net cash provided by (used in) operating activities',
    'Net cash provided by (used in) investing activities',
    'Net cash provided by (used in) financing activities',
    'Net increase (decrease) in cash',
    'Cash at end of period',
  ])

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Cash Flow')
    const headerRow = ws.addRow(headers)
    headerRow.font = { bold: true }
    for (const r of rows) {
      const row = ws.addRow(r)
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
      })
      if (typeof r[0] === 'string' && boldLabels.has(r[0])) row.font = { bold: true }
    }
    ws.columns.forEach((col, i) => {
      col.width = i === 0 ? 56 : 16
    })
    const buf = await wb.xlsx.writeBuffer()
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${basename}.xlsx"`,
      },
    })
  }

  const csv = formatCsv(
    headers.map(String),
    rows.map((r) => r.map((v) => (typeof v === 'number' ? v.toFixed(2) : String(v))))
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${basename}.csv"`,
    },
  })
}
