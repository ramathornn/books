'use client'

import { formatCurrency } from '@/lib/utils'

interface MonthlyPoint {
  month: string
  collected: number
  expenses: number
}

interface RevenueExpensesChartProps {
  points: MonthlyPoint[]
  totalCollected: number
  totalExpenses: number
  totalOutstanding: number
  currency: string
}

function niceCeiling(n: number): number {
  if (n <= 0) return 0
  const pow = Math.pow(10, Math.floor(Math.log10(n)))
  const f = n / pow
  let nf: number
  if (f <= 1) nf = 1
  else if (f <= 2) nf = 2
  else if (f <= 2.5) nf = 2.5
  else if (f <= 5) nf = 5
  else nf = 10
  return nf * pow
}

function formatAxisTick(v: number): string {
  if (v >= 1000) return `${+(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
  return String(Math.round(v))
}

export function RevenueExpensesChart({
  points,
  totalCollected,
  totalExpenses,
  totalOutstanding,
  currency,
}: RevenueExpensesChartProps) {
  const rawMax = Math.max(1, ...points.flatMap((p) => [p.collected, p.expenses]))
  const maxVal = niceCeiling(rawMax)
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => ({
    frac: f,
    value: maxVal * f,
  }))

  // SVG area chart — same geometry/style as the Total Profit chart below it.
  const width = 1000
  const height = 220
  const padding = { top: 12, right: 12, bottom: 24, left: 0 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const coords = points.map((p, i) => {
    const stepX = points.length > 1 ? plotW / (points.length - 1) : 0
    const x = padding.left + i * stepX
    const yOf = (v: number) => padding.top + plotH - (Math.max(v, 0) / maxVal) * plotH
    return { x, yCollected: yOf(p.collected), yExpenses: yOf(p.expenses), ...p }
  })

  // Only draw up to the last month with activity (avoids a misleading
  // drop-to-zero tail for months that haven't happened yet). A bank-feed
  // business can have expense-only months, so expenses count as activity too.
  const lastWithData = (() => {
    for (let i = coords.length - 1; i >= 0; i--) {
      if (coords[i].collected > 0 || coords[i].expenses > 0) return i
    }
    return -1
  })()
  const drawn = lastWithData >= 0 ? coords.slice(0, lastWithData + 1) : []

  const pathOf = (ys: (c: (typeof coords)[number]) => number) =>
    drawn.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${ys(c).toFixed(1)}`).join(' ')

  const collectedLine = drawn.length > 0 ? pathOf((c) => c.yCollected) : ''
  const collectedArea =
    drawn.length > 0
      ? `${collectedLine} L ${drawn[drawn.length - 1].x.toFixed(1)} ${(padding.top + plotH).toFixed(1)} L ${drawn[0].x.toFixed(1)} ${(padding.top + plotH).toFixed(1)} Z`
      : ''
  const expensesLine = drawn.length > 0 ? pathOf((c) => c.yExpenses) : ''

  const yAxisW = 40
  const svgW = yAxisW + plotW + padding.right
  const svgH = height + 16

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div className="flex-1 min-w-0">
        <svg
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto max-w-full"
        >
          {ticks.map((t) => {
            const y = padding.top + plotH * (1 - t.frac)
            return (
              <g key={t.frac}>
                <line
                  x1={yAxisW}
                  x2={yAxisW + plotW}
                  y1={y}
                  y2={y}
                  stroke="#E5E7EB"
                  strokeWidth="1"
                />
                <text
                  x={yAxisW - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="11"
                  fill="#8C9BAB"
                >
                  {formatAxisTick(t.value)}
                </text>
              </g>
            )
          })}

          <g transform={`translate(${yAxisW}, 0)`}>
            {collectedArea && <path d={collectedArea} fill="#D4F0DE" />}
            {expensesLine && (
              <path
                d={expensesLine}
                fill="none"
                stroke="#F0627E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {collectedLine && (
              <path
                d={collectedLine}
                fill="none"
                stroke="#5FC794"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {drawn.map((c) => (
              <circle
                key={`exp-${c.month}`}
                cx={c.x}
                cy={c.yExpenses}
                r="5"
                fill="white"
                stroke="#F0627E"
                strokeWidth="2"
              />
            ))}
            {drawn.map((c) => (
              <circle
                key={c.month}
                cx={c.x}
                cy={c.yCollected}
                r="5"
                fill="white"
                stroke="#5FC794"
                strokeWidth="2"
              />
            ))}
          </g>

          {coords.map((c) => (
            <text
              key={c.month}
              x={yAxisW + c.x}
              y={svgH - 4}
              textAnchor="middle"
              fontSize="11"
              fill="#576981"
            >
              {c.month}
            </text>
          ))}
        </svg>

        {/* Legend */}
        <div className="pl-10 mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[12px] leading-none text-[#001B40]">
          <span className="flex items-center gap-2 whitespace-nowrap">
            <span className="w-4 h-3 rounded-sm bg-[#D4F0DE] border-b-2 border-[#5FC794] inline-block flex-shrink-0" />
            Revenue
          </span>
          <span className="flex items-center gap-2 whitespace-nowrap">
            <svg className="w-5 h-3 flex-shrink-0" viewBox="0 0 20 12">
              <line x1="0" y1="6" x2="20" y2="6" stroke="#F0627E" strokeWidth="2" />
            </svg>
            Expenses
          </span>
        </div>
      </div>

      {/* Summary table */}
      <div className="w-full lg:w-56 flex-shrink-0 lg:border-l border-t lg:border-t-0 border-[#E1E6EB] pt-4 lg:pt-0 lg:pl-6 text-sm">
        <div className="text-[13px] font-semibold text-[#001B40] mb-3">
          Summary of the past 6 months
        </div>
        <div className="mb-4">
          <div className="text-[13px] font-semibold text-[#001B40] mb-2">Revenue</div>
          <div className="flex items-center justify-between text-[12px] text-[#576981]">
            <span>Total Income</span>
            <span className="text-[#001B40]">
              {formatCurrency(totalCollected, currency, { includeCode: false })}
            </span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-[#576981] mt-1">
            <span>Outstanding Invoices</span>
            <span className="text-[#0075DD]">
              {formatCurrency(totalOutstanding, currency, { includeCode: false })}
            </span>
          </div>
        </div>
        <div>
          <div className="text-[13px] font-semibold text-[#001B40] mb-2">Expenses</div>
          <div className="flex items-center justify-between text-[12px] text-[#576981]">
            <span>Amount Spent</span>
            <span className="text-[#001B40]">
              {formatCurrency(totalExpenses, currency, { includeCode: false })}
            </span>
          </div>
          <div className="flex items-center justify-between text-[12px] text-[#576981] mt-1">
            <span>Outstanding Bills</span>
            <span className="text-[#001B40]">
              {formatCurrency(0, currency, { includeCode: false })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

interface ProfitChartProps {
  points: { month: string; profit: number }[]
  totalProfit: number
  currency: string
}

export function ProfitChart({ points, totalProfit, currency }: ProfitChartProps) {
  const rawMax = Math.max(1, ...points.map((p) => p.profit))
  const maxVal = niceCeiling(rawMax)
  const ticks = [1, 0.75, 0.5, 0.25, 0].map((f) => ({
    frac: f,
    value: maxVal * f,
  }))

  const width = 1000
  const height = 220
  const padding = { top: 12, right: 12, bottom: 24, left: 0 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  const coords = points.map((p, i) => {
    const stepX = points.length > 1 ? plotW / (points.length - 1) : 0
    const x = padding.left + i * stepX
    const y = padding.top + plotH - (Math.max(p.profit, 0) / maxVal) * plotH
    return { x, y, month: p.month, profit: p.profit }
  })

  // Only draw the area/line up to the last month with actual data. GL netProfit
  // can be negative (loss months), so a non-zero value counts as data — otherwise
  // a trailing loss month would be wrongly truncated as "no data".
  const lastWithData = (() => {
    for (let i = coords.length - 1; i >= 0; i--) {
      if (coords[i].profit !== 0) return i
    }
    return -1
  })()

  const drawn = lastWithData >= 0 ? coords.slice(0, lastWithData + 1) : []

  const linePath =
    drawn.length > 0
      ? drawn
          .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
          .join(' ')
      : ''

  const areaPath =
    drawn.length > 0
      ? `${linePath} L ${drawn[drawn.length - 1].x.toFixed(1)} ${(padding.top + plotH).toFixed(1)} L ${drawn[0].x.toFixed(1)} ${(padding.top + plotH).toFixed(1)} Z`
      : ''

  const yAxisW = 40
  const svgW = yAxisW + plotW + padding.right
  const svgH = height + 16

  return (
    <div className="relative">
      <div className="sm:absolute sm:top-0 sm:right-0 text-right z-10 mb-3 sm:mb-0">
        <div className="text-[24px] sm:text-[28px] leading-none font-semibold text-[#0075DD] break-words">
          {formatCurrency(totalProfit, currency, { includeCode: false, decimals: 0 })}
        </div>
        <div className="text-xs text-[#576981] mt-1">total profit</div>
      </div>
      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full h-auto max-w-full"
      >
        {ticks.map((t) => {
          const y = padding.top + plotH * (1 - t.frac)
          return (
            <g key={t.frac}>
              <line
                x1={yAxisW}
                x2={yAxisW + plotW}
                y1={y}
                y2={y}
                stroke="#E5E7EB"
                strokeWidth="1"
              />
              <text
                x={yAxisW - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="11"
                fill="#8C9BAB"
              >
                {formatAxisTick(t.value)}
              </text>
            </g>
          )
        })}

        <g transform={`translate(${yAxisW}, 0)`}>
          {areaPath && <path d={areaPath} fill="#D4F0DE" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="#5FC794"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {drawn.map((c) => (
            <circle
              key={c.month}
              cx={c.x}
              cy={c.y}
              r="5"
              fill="white"
              stroke="#5FC794"
              strokeWidth="2"
            />
          ))}
        </g>

        {coords.map((c) => (
          <text
            key={c.month}
            x={yAxisW + c.x}
            y={svgH - 4}
            textAnchor="middle"
            fontSize="11"
            fill="#576981"
            style={{ textTransform: 'uppercase' }}
          >
            {c.month}
          </text>
        ))}
      </svg>
    </div>
  )
}

export default RevenueExpensesChart
