import { computeMonthlyPL, computePLFromGL } from '@/lib/reports/profitAndLoss'

/**
 * Dashboard money figures, sourced from the GENERAL LEDGER (accrual) rather than
 * the invoice subledger. This is what every mainstream accounting package
 * does: dashboard Revenue / Expenses / Profit come from the income statement, while
 * invoice/AR and bill/AP live in their own separate widgets.
 *
 * Everything here is built on `computeMonthlyPL` / `computePLFromGL` — the exact
 * functions behind Reports → Profit & Loss — so the dashboard ties out to the P&L
 * report to the penny. The GL is CAD, so all figures are CAD (no FX conversion).
 */

// Axis labels: short month, with a 2-digit year suffix only when the year differs
// from the current year — matching the dashboard's existing tick convention.
// (Ported from the helpers previously inline in dashboard/page.tsx.)
// UTC getters: period starts are UTC-midnight instants (lib/reports/profitAndLoss),
// which local getters would render as the previous month on any box west of
// Greenwich. `now` stays on local getters — it's the wall-clock business year.
function monthLabel(d: Date, now: Date): string {
  return (
    d.toLocaleString('default', { month: 'short', timeZone: 'UTC' }) +
    (d.getUTCFullYear() !== now.getFullYear() ? ` ${String(d.getUTCFullYear()).slice(2)}` : '')
  )
}
function quarterLabel(d: Date, now: Date): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1
  return (
    `Q${q}` +
    (d.getUTCFullYear() !== now.getFullYear() ? ` ${String(d.getUTCFullYear()).slice(2)}` : '')
  )
}

export async function getGlDashboardFinancials(opts: {
  revenueRange: { start: Date; end: Date }
  profitRange: { start: Date; end: Date }
  profitGroupBy: 'month' | 'quarter'
  spendingRange: { start: Date; end: Date }
}): Promise<{
  revenuePoints: { month: string; collected: number; expenses: number }[]
  totalRevenue: number
  totalExpenses: number
  profitPoints: { month: string; profit: number }[]
  totalProfit: number
  totalSpending: number
}> {
  const now = new Date()

  const [revenueMonthly, profitMonthly, spending] = await Promise.all([
    computeMonthlyPL(opts.revenueRange.start, opts.revenueRange.end, 'CAD', 'accrual'),
    computeMonthlyPL(opts.profitRange.start, opts.profitRange.end, 'CAD', 'accrual'),
    computePLFromGL(opts.spendingRange.start, opts.spendingRange.end),
  ])

  const revenuePoints = revenueMonthly.periods.map((m) => ({
    month: monthLabel(m.start, now),
    collected: m.totalIncome,
    expenses: m.totalExpenses,
  }))

  let profitPoints: { month: string; profit: number }[]
  if (opts.profitGroupBy === 'quarter') {
    // Aggregate the per-month rows into quarter buckets, grouping by each month's start.
    const buckets: { key: string; profit: number }[] = []
    const index = new Map<string, number>()
    for (const m of profitMonthly.periods) {
      const key = quarterLabel(m.start, now)
      if (!index.has(key)) {
        index.set(key, buckets.length)
        buckets.push({ key, profit: 0 })
      }
      buckets[index.get(key)!].profit += m.netProfit
    }
    profitPoints = buckets.map((b) => ({ month: b.key, profit: b.profit }))
  } else {
    profitPoints = profitMonthly.periods.map((m) => ({
      month: monthLabel(m.start, now),
      profit: m.netProfit,
    }))
  }

  return {
    revenuePoints,
    totalRevenue: revenueMonthly.total.totalIncome,
    totalExpenses: revenueMonthly.total.totalExpenses,
    profitPoints,
    totalProfit: profitMonthly.total.netProfit,
    totalSpending: spending.totalExpenses,
  }
}
