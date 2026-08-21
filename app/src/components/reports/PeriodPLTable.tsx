import { formatCurrency } from '@/lib/utils'
import { buildPeriodPLRows, type PeriodPL, type PeriodPLRow } from '@/lib/reports/profitAndLoss'

/**
 * The P&L laid out one column per period — the "display columns by month /
 * quarter" view most accounting packages ship. Shared by the By Month, By Quarter and
 * By Fiscal Quarter tabs so the three stay identical apart from their columns,
 * and built from `buildPeriodPLRows` so the CSV/Excel export of any of them
 * matches the table exactly.
 *
 * No scroll wrapper here: `ReportLayout`'s card is already `overflow-x-auto`,
 * and the cells carry `whitespace-nowrap` so wide ranges scroll rather than wrap.
 */
export default function PeriodPLTable({
  data,
  currency,
}: {
  data: PeriodPL
  currency: string
}) {
  const { headers, rows } = buildPeriodPLRows(data)
  const periodHeaders = headers.slice(1, -1)
  const money = (n: number) => formatCurrency(n, currency, { includeCode: false })

  // Section bands span the table; every other row is label + one cell per period + total.
  const columnCount = periodHeaders.length + 2

  const labelClass = (row: PeriodPLRow) => {
    switch (row.kind) {
      case 'account':
        return 'px-4 py-1 pl-8 text-sm text-[#001B40] whitespace-nowrap'
      case 'net':
        return 'px-4 py-1 text-sm font-bold text-[#001B40] whitespace-nowrap'
      case 'memo':
        return 'px-4 py-1 text-sm font-bold text-[#001B40] whitespace-nowrap'
      default:
        return 'px-4 py-1 text-sm font-semibold text-[#001B40] whitespace-nowrap'
    }
  }

  const rowClass = (row: PeriodPLRow) => {
    switch (row.kind) {
      case 'subtotal':
        return 'border-b border-[#E1E6EB] bg-[#F5F7FA]'
      case 'net':
        return 'border-b border-[#E1E6EB] border-t-2 border-t-[#001B40]'
      case 'memo':
        return 'bg-[#F5F7FA]'
      default:
        return 'border-b border-[#E1E6EB]'
    }
  }

  const valueClass = (row: PeriodPLRow, value: number) => {
    const weight = row.kind === 'account' ? '' : ' font-semibold'
    const colour = row.signed
      ? value >= 0
        ? ' text-[#006644]'
        : ' text-[#BF2600]'
      : ' text-[#001B40]'
    return `px-4 py-1 text-sm text-right whitespace-nowrap${weight}${colour}`
  }

  const totalClass = (row: PeriodPLRow, value: number) => {
    const colour = row.signed
      ? value >= 0
        ? ' text-[#006644]'
        : ' text-[#BF2600]'
      : ' text-[#001B40]'
    return `px-4 py-1 text-sm text-right font-bold whitespace-nowrap${colour}`
  }

  return (
    <>
      <table className="w-full">
        <thead>
          <tr className="border-b border-[#E1E6EB]">
            <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]"></th>
            {periodHeaders.map((h) => (
              <th
                key={h}
                className="px-4 py-1 text-right text-xs font-semibold text-[#576981] whitespace-nowrap"
              >
                {h}
              </th>
            ))}
            <th className="px-4 py-1 text-right text-xs font-semibold text-[#001B40] whitespace-nowrap">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) =>
            row.kind === 'section' ? (
              <tr key={ri} className="bg-[#F5F7FA] border-b border-[#E1E6EB]">
                <td colSpan={columnCount} className="px-4 py-2 text-sm font-semibold text-[#001B40]">
                  {row.label}
                </td>
              </tr>
            ) : (
              <tr key={ri} className={rowClass(row)}>
                <td className={labelClass(row)}>{row.label}</td>
                {row.values.map((v, i) => (
                  <td key={periodHeaders[i]} className={valueClass(row, v)}>
                    {money(v)}
                  </td>
                ))}
                {row.total === null ? (
                  <td className="px-4 py-1" />
                ) : (
                  <td className={totalClass(row, row.total)}>{money(row.total)}</td>
                )}
              </tr>
            )
          )}
        </tbody>
      </table>
      {data.kind !== 'month' && (
        <p className="mt-3 px-4 text-xs text-[#576981]">
          Trailing 4 Quarters sums each column with the three before it, so the first three columns
          of a range cover fewer than four quarters.
          {data.kind === 'quarter'
            ? ' Quarters are calendar quarters, matching how the Excise Tax Act measures the small-supplier threshold.'
            : ' Quarters follow the fiscal year end.'}
        </p>
      )}
    </>
  )
}
