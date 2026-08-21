import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { auth } from '@/lib/auth'
import { formatCsv } from '@/lib/csv'
import { resolveReportRange, resolveCustomReportRange } from '@/lib/reportRange'
import { parseCurrencyParam } from '@/lib/reportCurrency'
import { getCompanySettings } from '@/lib/company'
import {
  buildPeriodPLRows,
  computeMonthlyPL,
  computeQuarterlyPL,
  computeFiscalQuarterlyPL,
} from '@/lib/reports/profitAndLoss'

// The general ledger is maintained in CAD, so the GL-based P&L is always CAD.
const GL_CURRENCY = 'CAD'

/** How ?tab= (as forwarded by ReportLayout's Download menu) maps to a column series. */
const VIEWS = {
  monthly: { slug: 'monthly', sheet: 'P&L Monthly' },
  quarterly: { slug: 'quarterly', sheet: 'P&L Quarterly' },
  'fiscal-quarterly': { slug: 'fiscal-quarterly', sheet: 'P&L Fiscal Quarters' },
} as const

/**
 * Period-by-period P&L export (?format=csv | xlsx, default csv): one column per
 * calendar month, calendar quarter or fiscal quarter (?tab=, default monthly)
 * across the requested range (?preset= or ?start=&end=), with per-account
 * income and expense rows, net profit, and a running cumulative net.
 *
 * Rows come from `buildPeriodPLRows`, the same builder the on-screen table uses,
 * so a downloaded file always matches the view it was downloaded from.
 *
 * The export is the pure statement — income and expenses only. Balance-sheet
 * activity (e.g. owner draws in a shareholder-loan account) belongs on the
 * General Ledger report, which has its own export.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const preset = sp.get('preset') || 'this-year'
  const format = sp.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const basis: 'accrual' | 'cash' = sp.get('basis') === 'cash' ? 'cash' : 'accrual'
  const requestedCurrency =
    parseCurrencyParam({ currency: sp.get('currency') ?? undefined }) || GL_CURRENCY
  const currency = basis === 'cash' ? requestedCurrency : GL_CURRENCY

  const company = await getCompanySettings()
  const range =
    resolveCustomReportRange(sp.get('start') ?? undefined, sp.get('end') ?? undefined) ??
    resolveReportRange(preset, undefined, company.fiscalYearEnd)

  const tab = sp.get('tab')
  const view = (tab && tab in VIEWS ? VIEWS[tab as keyof typeof VIEWS] : VIEWS.monthly)
  const data =
    view.slug === 'quarterly'
      ? await computeQuarterlyPL(range.start, range.end, currency, basis)
      : view.slug === 'fiscal-quarterly'
        ? await computeFiscalQuarterlyPL(
            range.start,
            range.end,
            currency,
            basis,
            company.fiscalYearEnd
          )
        : await computeMonthlyPL(range.start, range.end, currency, basis)

  const money = (n: number) => Math.round(n * 100) / 100
  const { headers, rows: plRows } = buildPeriodPLRows(data)
  // Section bands carry no values, so pad them out to keep every line the same
  // width as the header — a ragged CSV imports badly.
  const rows: Array<Array<string | number>> = plRows.map((r) => [
    r.label,
    ...(r.kind === 'section' ? data.periods.map(() => '') : r.values.map(money)),
    r.total === null ? '' : money(r.total),
  ])

  // Boundaries and entry dates are UTC calendar-date instants (lib/reportRange),
  // so the UTC date IS the calendar date.
  const dateLabel = (d: Date) => d.toISOString().slice(0, 10)
  const basename = `profit-and-loss-${view.slug}-${dateLabel(range.start)}-${dateLabel(range.end)}`

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet(view.sheet)
    const headerRow = ws.addRow(headers)
    headerRow.font = { bold: true }
    rows.forEach((r, i) => {
      const row = ws.addRow(r)
      row.eachCell((cell) => {
        if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
      })
      const kind = plRows[i].kind
      if (kind !== 'account') row.font = { bold: true }
    })
    ws.columns.forEach((col, i) => {
      col.width = i === 0 ? 48 : 12
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
    rows.map((r) => r.map((v) => (typeof v === 'number' ? v.toFixed(2) : v)))
  )
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${basename}.csv"`,
    },
  })
}
