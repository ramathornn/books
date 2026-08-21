export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { formatCurrency } from '@/lib/utils'
import CreateNewDropdown from '@/components/ui/CreateNewDropdown'
import DateRangeSelector from '@/components/ui/DateRangeSelector'
import ProfitFilterPopover from '@/components/dashboard/ProfitFilterPopover'
import {
  resolveDateRange,
  isValidRangeKey,
  type DateRangeKey,
} from '@/lib/dateRanges'
import { SUPPORTED_CURRENCIES } from '@/lib/reportCurrency'
import DashboardWidgets from './DashboardWidgets'
import { getGlDashboardFinancials } from '@/lib/dashboardGl'
import {
  RevenueExpensesChart,
  ProfitChart,
} from './DashboardCharts'

export const metadata: Metadata = {
  title: 'Dashboard',
}

type AgingKey = '0-30' | '31-60' | '61-90' | '90+'

function formatTick(v: number): string {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}m`
  if (v >= 1000) return `${+(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`
  return String(Math.round(v))
}

function buildAxisTicks(max: number): { value: number; label: string; pct: number }[] {
  if (max <= 0) return []
  const niceMax = niceCeiling(max)
  const step = niceMax / 4
  return [0, 1, 2, 3, 4].map((i) => {
    const value = step * i
    return {
      value,
      label: formatTick(value),
      pct: (value / niceMax) * 100,
    }
  })
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

function pickRange(raw: unknown, fallback: DateRangeKey): DateRangeKey {
  if (typeof raw === 'string' && isValidRangeKey(raw)) return raw
  return fallback
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams

  // ---- Auto-pick a sensible default currency: whichever has the most outstanding,
  // falling back to whichever has the most invoice history, falling back to CAD. ----
  let currency: string
  if (typeof params.currency === 'string') {
    currency = params.currency
  } else {
    const byCurrencyOutstanding = await prisma.invoice.groupBy({
      by: ['currency'],
      where: { status: { notIn: ['paid', 'draft'] } },
      _sum: { amountDue: true },
    })
    const ranked = byCurrencyOutstanding
      .map((r) => ({
        currency: r.currency,
        amount: Number(r._sum.amountDue || 0),
      }))
      .filter((r) => r.amount > 0)
      .sort((a, b) => b.amount - a.amount)
    if (ranked.length > 0) {
      currency = ranked[0].currency
    } else {
      const byCount = await prisma.invoice.groupBy({
        by: ['currency'],
        _count: { currency: true },
        orderBy: { _count: { currency: 'desc' } },
        take: 1,
      })
      currency = byCount[0]?.currency || 'CAD'
    }
  }

  const now = new Date()

  // Resolve date ranges from URL params, or use sensible defaults.
  const profitRangeKey = pickRange(params.profitRange, 'this-year')
  const revenueRangeKey = pickRange(params.revenueRange, 'last-6-months')
  const spendingRangeKey = pickRange(params.spendingRange, 'this-year')

  const revenueRange = resolveDateRange(revenueRangeKey, now)
  const spendingRange = resolveDateRange(spendingRangeKey, now)

  // Profit range supports either the preset key or explicit profitStart/profitEnd
  // (set by the ProfitFilterPopover) plus a month|quarter grouping.
  function parseISODate(s: string, endOfDay = false): Date | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
    const [y, m, d] = s.split('-').map(Number)
    return endOfDay
      ? new Date(y, m - 1, d, 23, 59, 59)
      : new Date(y, m - 1, d)
  }
  function toISO(d: Date): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  function fmtHuman(d: Date): string {
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const rawProfitStart =
    typeof params.profitStart === 'string' ? params.profitStart : ''
  const rawProfitEnd =
    typeof params.profitEnd === 'string' ? params.profitEnd : ''
  const customStart = parseISODate(rawProfitStart)
  const customEnd = parseISODate(rawProfitEnd, true)

  let profitRange: { start: Date; end: Date; label: string }
  if (customStart && customEnd && customStart <= customEnd) {
    profitRange = {
      start: customStart,
      end: customEnd,
      label: `for ${fmtHuman(customStart)} to ${fmtHuman(customEnd)}`,
    }
  } else {
    profitRange = resolveDateRange(profitRangeKey, now)
  }

  const profitGroupBy: 'month' | 'quarter' =
    params.profitGroupBy === 'quarter' ? 'quarter' : 'month'

  // ---- Invoices: one tile per currency (overdue + outstanding + draft) ----
  // Draft amounts are hidden from accountant (read-only) sessions.
  const session = await auth()
  const hideDrafts = session?.user?.role === 'accountant'
  const outstandingCurrencies = ['CAD', 'USD', 'EUR'] as const
  const [allOutstandingInvoices, allDraftInvoices] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: { notIn: ['paid', 'draft'] },
        currency: { in: [...outstandingCurrencies] },
      },
      select: { amountDue: true, dateDue: true, currency: true },
    }),
    hideDrafts
      ? Promise.resolve([])
      : prisma.invoice.findMany({
          where: {
            status: 'draft',
            currency: { in: [...outstandingCurrencies] },
          },
          select: { total: true, currency: true },
        }),
  ])

  const outstandingByCurrency = outstandingCurrencies.map((cur) => {
    const invs = allOutstandingInvoices.filter((i) => i.currency === cur)
    const a: Record<AgingKey, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    }
    let overdue = 0
    for (const inv of invs) {
      const daysPastDue = Math.floor(
        (now.getTime() - new Date(inv.dateDue).getTime()) / (1000 * 60 * 60 * 24)
      )
      const amt = Number(inv.amountDue)
      if (daysPastDue > 0) overdue += amt
      if (daysPastDue <= 30) a['0-30'] += amt
      else if (daysPastDue <= 60) a['31-60'] += amt
      else if (daysPastDue <= 90) a['61-90'] += amt
      else a['90+'] += amt
    }
    const outstandingTotal = invs.reduce((s, i) => s + Number(i.amountDue), 0)
    const draftTotal = allDraftInvoices
      .filter((d) => d.currency === cur)
      .reduce((s, d) => s + Number(d.total), 0)
    const total = outstandingTotal + draftTotal
    return {
      currency: cur,
      aging: a,
      totalOverdue: overdue,
      totalOutstanding: outstandingTotal,
      outstandingNotOverdue: Math.max(0, outstandingTotal - overdue),
      totalDraft: draftTotal,
      total,
    }
  })

  // CAD-converted total outstanding across all currencies, used by the
  // Revenue and Expenses summary panel (which now reports in CAD).
  const totalOutstandingCad = allOutstandingInvoices.reduce(
    (sum, inv) => sum + Number(inv.amountDue) * (({ CAD: 1, USD: 1.36, EUR: 1.45 } as Record<string, number>)[inv.currency] ?? 1),
    0
  )

  // ---- Dashboard money figures from the GENERAL LEDGER (accrual), not the
  // invoice subledger. Revenue, Expenses, Profit, and Spending all come from the
  // GL income statement — the same source as Reports → Profit & Loss, so they tie
  // out to the penny — which lights up the previously dead-zero expense widgets
  // for bank-feed businesses and equals invoiced revenue for invoice-driven ones.
  // The GL is CAD, so these are CAD (no FX). ----
  const gl = await getGlDashboardFinancials({
    revenueRange,
    profitRange,
    profitGroupBy,
    spendingRange,
  })

  // ---- Revenue by client, per currency (for the selected revenue range) ----
  // We compute every supported currency up front so the widget can toggle between
  // them instantly on the client, without reloading the rest of the dashboard.
  const revenueByClientRaw = await prisma.payment.groupBy({
    by: ['clientId', 'currency'],
    where: {
      status: 'paid',
      currency: { in: [...SUPPORTED_CURRENCIES] },
      paymentDate: { gte: revenueRange.start, lte: revenueRange.end },
    },
    _sum: { amount: true },
  })

  const revClientIds = Array.from(
    new Set(revenueByClientRaw.map((r) => r.clientId).filter((id): id is string => !!id))
  )
  const revClients = revClientIds.length
    ? await prisma.client.findMany({
        where: { id: { in: revClientIds } },
        select: { id: true, firstName: true, lastName: true, organization: true },
      })
    : []
  const revClientMap = new Map(revClients.map((c) => [c.id, c]))
  const clientName = (id: string | null): string => {
    if (!id) return 'Unknown'
    const c = revClientMap.get(id)
    if (!c) return 'Unknown'
    return c.organization || `${c.firstName} ${c.lastName}`.trim() || 'Unknown'
  }

  const revenueByCurrency: Record<
    string,
    { topClients: { name: string; amount: number }[]; total: number }
  > = {}
  for (const cur of SUPPORTED_CURRENCIES) {
    const rows = revenueByClientRaw
      .filter((r) => r.currency === cur)
      .map((r) => ({ name: clientName(r.clientId), amount: Number(r._sum.amount || 0) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
    revenueByCurrency[cur] = {
      topClients: rows,
      total: rows.reduce((sum, c) => sum + c.amount, 0),
    }
  }

  const ageBreakdown: { key: AgingKey; label: string }[] = [
    { key: '0-30', label: '0-30 Days' },
    { key: '31-60', label: '31-60 Days' },
    { key: '61-90', label: '61-90 Days' },
    { key: '90+', label: '91+ Days' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div className="flex items-center gap-2">
          <h1>Dashboard</h1>
          <button
            className="w-6 h-6 text-[#576981] hover:text-[#001B40]"
            title="Edit dashboard"
            aria-label="Edit dashboard"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
        </div>
        <div className="flex items-center gap-5 flex-wrap">
          <Link
            href="/team-members"
            className="text-sm font-medium text-[#001B40] hover:underline"
          >
            Add Team Member
          </Link>
          <CreateNewDropdown />
        </div>
      </div>

      <div className="space-y-6">
        {/* Invoices — one tile per currency (overdue + outstanding + draft) */}
        <div>
          <div className="flex items-center justify-between mb-3 gap-4">
            <h2>Invoices</h2>
          </div>

          <div className="flex flex-col lg:flex-row gap-5 items-stretch">
            {outstandingByCurrency.map((bucket) => (
              <div key={bucket.currency} className="flex-1 min-w-0 flex flex-col bg-white rounded-lg border border-[#E1E6EB] px-4 sm:px-6 pt-3 pb-4 overflow-hidden">
                {/* Header: currency left, total top-right */}
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="text-[13px] font-semibold text-[#001B40] pt-1">
                    {bucket.currency}
                  </div>
                  <div className="text-right">
                    <div className="text-[28px] leading-none font-semibold text-[#0075DD]">
                      {formatCurrency(bucket.total, bucket.currency, { includeCode: false, decimals: 0 })}
                    </div>
                    <div className="text-xs text-[#576981] mt-1">
                      total
                    </div>
                  </div>
                </div>

                {/* Body: 50/50 — bar + legend | day breakdown */}
                <div className="flex flex-col sm:flex-row gap-6 mt-auto">
                  <div className="flex-1 min-w-0">
                    {bucket.total === 0 ? (
                      <div className="h-7 rounded bg-[#F5F7FA] flex items-center justify-center text-xs text-[#576981]">
                        No invoices
                      </div>
                    ) : (
                      <>
                        {/* X-axis tick labels */}
                        <div className="relative h-4 mb-1">
                          {buildAxisTicks(bucket.total).map((t) => (
                            <span
                              key={t.value}
                              className="absolute text-[11px] text-[#576981] -translate-x-1/2"
                              style={{ left: `${t.pct}%` }}
                            >
                              {t.label}
                            </span>
                          ))}
                        </div>
                        <div className="flex h-7 rounded-sm overflow-hidden relative">
                          {bucket.totalOverdue > 0 && (
                            <div
                              className="bg-[#F0627E]"
                              style={{
                                width: `${(bucket.totalOverdue / bucket.total) * 100}%`,
                              }}
                              title={`Overdue: ${formatCurrency(bucket.totalOverdue, bucket.currency)}`}
                            />
                          )}
                          {bucket.outstandingNotOverdue > 0 && (
                            <div
                              className="bg-[#F1D878]"
                              style={{
                                width: `${(bucket.outstandingNotOverdue / bucket.total) * 100}%`,
                              }}
                              title={`Outstanding: ${formatCurrency(bucket.outstandingNotOverdue, bucket.currency)}`}
                            />
                          )}
                          {bucket.totalDraft > 0 && (
                            <div
                              className="bg-[#B4BFCC]"
                              style={{
                                width: `${(bucket.totalDraft / bucket.total) * 100}%`,
                              }}
                              title={`Draft: ${formatCurrency(bucket.totalDraft, bucket.currency)}`}
                            />
                          )}
                        </div>
                      </>
                    )}
                    <div className="flex flex-col gap-1.5 mt-3 text-xs text-[#001B40]">
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#F0627E] inline-block" />
                        Overdue
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#F1D878] inline-block" />
                        Outstanding
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#B4BFCC] inline-block" />
                        Draft
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 min-w-0 text-[13px] space-y-1">
                    {ageBreakdown.map((row) => (
                      <div
                        key={row.key}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="text-[#576981]">{row.label}</span>
                        <span className="text-[#0075DD]">
                          {formatCurrency(bucket.aging[row.key], bucket.currency, { includeCode: false })}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#E1E6EB]">
                      <span className="text-[#576981]">Draft</span>
                      <span className="text-[#0075DD]">
                        {formatCurrency(bucket.totalDraft, bucket.currency, { includeCode: false })}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Revenue and Expenses — combined, converted to CAD */}
        <div>
          <div className="flex items-baseline gap-2 mb-3 flex-wrap">
            <h2>Revenue and Expenses</h2>
            <span className="text-xs text-[#576981]">all currencies, in CAD</span>
          </div>
          <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 sm:p-6">
            <RevenueExpensesChart
              points={gl.revenuePoints}
              totalCollected={gl.totalRevenue}
              totalExpenses={gl.totalExpenses}
              totalOutstanding={totalOutstandingCad}
              currency="CAD"
            />
          </div>
        </div>

        {/* Total Profit */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 gap-2">
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2>Total Profit</h2>
              <ProfitFilterPopover
                triggerLabel={`${profitRange.label} (CAD)`}
                start={toISO(profitRange.start)}
                end={toISO(profitRange.end)}
                groupBy={profitGroupBy}
                currency="CAD"
                hideCurrency
              />
            </div>
            <span
              className="text-sm text-[#0075DD] cursor-not-allowed"
              title="Coming soon"
            >
              View Profit and Loss Report
            </span>
          </div>
          <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 sm:p-6">
            <ProfitChart
              points={gl.profitPoints}
              totalProfit={gl.totalProfit}
              currency="CAD"
            />
          </div>
        </div>

        {/* Revenue by Client, Spending, Unbilled Time */}
        <DashboardWidgets
          revenueByCurrency={revenueByCurrency}
          revenueCurrencies={[...SUPPORTED_CURRENCIES]}
          currency={currency}
          totalSpending={gl.totalSpending}
          spendingRangeKey={spendingRangeKey}
          spendingRangeLabel={spendingRange.label}
        />
      </div>
    </div>
  )
}
