import { NextRequest } from 'next/server'
import ExcelJS from 'exceljs'
import { auth } from '@/lib/auth'
import { formatCsv } from '@/lib/csv'
import { resolveReportRange, resolveCustomReportRange } from '@/lib/reportRange'
import { parseCurrencyParam, defaultGLAccountCurrency } from '@/lib/reportCurrency'
import { getCompanySettings } from '@/lib/company'
import { generalLedgerByAccount } from '@/lib/reports/generalLedger'

/**
 * General-ledger export (?format=csv | xlsx, default csv) for the requested
 * range (?preset= or ?start=&end=) — the account-transaction-detail report a
 * bookkeeper pulls for per-account activity (every posted line, running
 * balance). CSV is flat (one row per line, account columns repeated) for
 * data work; xlsx is grouped by account with header rows, mirroring the
 * on-screen report, for reading.
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const preset = sp.get('preset') || 'this-month'
  const format = sp.get('format') === 'xlsx' ? 'xlsx' : 'csv'
  const currency =
    parseCurrencyParam({ currency: sp.get('currency') ?? undefined }) ||
    (await defaultGLAccountCurrency())

  const company = await getCompanySettings()
  const range =
    resolveCustomReportRange(sp.get('start') ?? undefined, sp.get('end') ?? undefined) ??
    resolveReportRange(preset, undefined, company.fiscalYearEnd)

  const accounts = await generalLedgerByAccount(range.start, range.end, currency)

  // Boundaries and entry dates are UTC calendar-date instants (lib/reportRange),
  // so the UTC date IS the calendar date.
  const dateLabel = (d: Date) => d.toISOString().slice(0, 10)
  const basename = `general-ledger-${dateLabel(range.start)}-${dateLabel(range.end)}`

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('General Ledger')
    for (const { account, rows } of accounts) {
      const title = ws.addRow([`${account.accountNumber} — ${account.accountName}`])
      title.font = { bold: true }
      const header = ws.addRow(['Date', 'Entry #', 'Note', 'Debit', 'Credit', 'Balance'])
      header.font = { bold: true }
      for (const r of rows) {
        const row = ws.addRow([
          dateLabel(r.date),
          r.entryNumber,
          r.description,
          r.debit || '',
          r.credit || '',
          r.balance,
        ])
        row.eachCell((cell) => {
          if (typeof cell.value === 'number') cell.numFmt = '#,##0.00'
        })
      }
      ws.addRow([])
    }
    const widths = [12, 12, 48, 12, 12, 12]
    ws.columns.forEach((col, i) => {
      col.width = widths[i] ?? 12
    })
    const buf = await wb.xlsx.writeBuffer()
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${basename}.xlsx"`,
      },
    })
  }

  const headers = ['Account #', 'Account Name', 'Date', 'Entry #', 'Note', 'Debit', 'Credit', 'Balance']
  const csvRows = accounts.flatMap(({ account, rows }) =>
    rows.map((r) => [
      account.accountNumber,
      account.accountName,
      dateLabel(r.date),
      r.entryNumber,
      r.description,
      r.debit ? r.debit.toFixed(2) : '',
      r.credit ? r.credit.toFixed(2) : '',
      r.balance.toFixed(2),
    ])
  )
  const csv = formatCsv(headers, csvRows)
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${basename}.csv"`,
    },
  })
}
