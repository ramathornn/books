'use client'

// Per-bracket view of a tax bill: how much income fell in each band and what it
// cost. Bar width is the income in that band (so you can see where the money
// sits); the right-hand figure is the tax on it.

import { fmtMoney } from '@/lib/forecasts/computed'

export interface TaxTier {
  jurisdiction: string
  rate: number
  from: number
  to: number
  amount: number
  tax: number
}

const money0 = (n: number) => `$${Math.round(n).toLocaleString()}`

/** "$0–57,375" / "$253,414+" */
function bandLabel(from: number, to: number): string {
  return to === Infinity || !Number.isFinite(to) ? `${money0(from)}+` : `${money0(from)}–${money0(to)}`
}

export default function TaxTiers({ tiers }: { tiers: TaxTier[] }) {
  const used = tiers.filter((t) => t.amount > 0)
  if (!used.length) return <p className="text-sm text-gray-400">No taxable income in this year.</p>

  const max = used.reduce((m, t) => Math.max(m, t.amount), 1)
  const jurisdictions = [...new Set(used.map((t) => t.jurisdiction))]

  return (
    <div className="space-y-4">
      {jurisdictions.map((j) => {
        const rows = used.filter((t) => t.jurisdiction === j)
        const subtotal = rows.reduce((s, t) => s + t.tax, 0)
        return (
          <div key={j}>
            <div className="mb-1.5 flex items-baseline justify-between">
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">{j}</h4>
              <span className="text-[12px] tabular-nums text-gray-500">{fmtMoney(subtotal)}</span>
            </div>
            <div className="space-y-1.5">
              {rows.map((t, i) => (
                <div key={i} className="grid grid-cols-[150px_1fr_90px] items-center gap-3 text-[13px]">
                  <span className="tabular-nums text-gray-600">
                    <span className="font-medium text-gray-900">{(t.rate * 100).toFixed(1)}%</span>
                    <span className="ml-1.5 text-[12px] text-gray-400">{bandLabel(t.from, t.to)}</span>
                  </span>
                  <div className="relative h-5 rounded bg-gray-100">
                    <div
                      className="h-full rounded bg-[#0075DD] transition-[width] duration-500"
                      style={{ width: `${Math.max(2, (t.amount / max) * 100)}%` }}
                    />
                    <span className="absolute right-2 top-0 text-[11px] leading-5 tabular-nums text-gray-600">{money0(t.amount)}</span>
                  </div>
                  <span className="text-right tabular-nums text-gray-900">{fmtMoney(t.tax)}</span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
      <p className="text-[12px] text-gray-400">Bar length is the income taxed in that band; the figure on the right is the tax it produced.</p>
    </div>
  )
}
