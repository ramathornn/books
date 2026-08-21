'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import DateRangeSelector from '@/components/ui/DateRangeSelector'
import CurrencySelector from '@/components/ui/CurrencySelector'
import { type DateRangeKey } from '@/lib/dateRanges'

interface ClientRevenue {
  name: string
  amount: number
}

interface CurrencyRevenue {
  topClients: ClientRevenue[]
  total: number
}

interface RevenueByClientProps {
  revenueByCurrency: Record<string, CurrencyRevenue>
  currencies: string[]
  defaultCurrency: string
}

const PIE_COLORS = [
  '#F87171', // red/coral
  '#F59E0B', // amber
  '#FBBF24', // yellow
  '#34D399', // teal-green
  '#0075DD', // brand blue
  '#8B5CF6', // purple
]

export function RevenueByClientWidget({
  revenueByCurrency,
  currencies,
  defaultCurrency,
}: RevenueByClientProps) {
  const [currency, setCurrency] = useState(
    currencies.includes(defaultCurrency) ? defaultCurrency : currencies[0]
  )
  const active = revenueByCurrency[currency] ?? { topClients: [], total: 0 }
  const topClients = active.topClients
  const totalClientRevenue = active.total

  const top5 = topClients.slice(0, 5)
  const othersAmount = topClients.slice(5).reduce((sum, c) => sum + c.amount, 0)
  const pieData: ClientRevenue[] = [...top5]
  if (othersAmount > 0) {
    pieData.push({ name: 'Others', amount: othersAmount })
  }

  function buildPieSlices() {
    if (pieData.length === 0 || totalClientRevenue === 0) return null

    let cumulativeAngle = 0
    return pieData.map((item, i) => {
      const sliceAngle = (item.amount / totalClientRevenue) * 360
      const startAngle = cumulativeAngle
      cumulativeAngle += sliceAngle

      if (sliceAngle >= 359.99) {
        return (
          <circle
            key={i}
            cx="50"
            cy="50"
            r="40"
            fill={PIE_COLORS[i % PIE_COLORS.length]}
          />
        )
      }

      const startRad = ((startAngle - 90) * Math.PI) / 180
      const endRad = ((startAngle + sliceAngle - 90) * Math.PI) / 180
      const largeArc = sliceAngle > 180 ? 1 : 0

      const x1 = 50 + 40 * Math.cos(startRad)
      const y1 = 50 + 40 * Math.sin(startRad)
      const x2 = 50 + 40 * Math.cos(endRad)
      const y2 = 50 + 40 * Math.sin(endRad)

      return (
        <path
          key={i}
          d={`M 50 50 L ${x1.toFixed(2)} ${y1.toFixed(2)} A 40 40 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`}
          fill={PIE_COLORS[i % PIE_COLORS.length]}
        />
      )
    })
  }

  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-[#001B40]">
            Revenue by Client
          </h2>
          <CurrencySelector
            selected={currency}
            onChange={setCurrency}
            currencies={currencies}
          />
        </div>
        <span
          className="text-xs text-[#0075DD] opacity-60 cursor-not-allowed"
          title="Coming soon"
        >
          View Revenue by Client Report
        </span>
      </div>

      {pieData.length === 0 ? (
        <div className="text-sm text-gray-400 text-center py-8">
          No revenue data yet.
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-8">
          <div className="flex items-center gap-6">
            <div className="w-28 h-28 sm:w-36 sm:h-36 flex-shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full">
                {totalClientRevenue === 0 ? (
                  <circle cx="50" cy="50" r="40" fill="#E5E7EB" />
                ) : (
                  buildPieSlices()
                )}
              </svg>
            </div>
            <div className="lg:hidden text-right">
              <div className="text-xs text-gray-500">Total Revenue</div>
              <div className="text-xl font-bold text-[#0075DD] mt-1 break-words">
                {formatCurrency(totalClientRevenue, currency)}
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-2 min-w-0">
            {pieData.map((client, i) => (
              <div
                key={`${client.name}-${i}`}
                className="flex items-center gap-2"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                />
                <span className="text-xs text-[#001B40] truncate flex-1">
                  {client.name}
                </span>
                <span className="text-xs font-medium text-[#0075DD] whitespace-nowrap">
                  {formatCurrency(client.amount, currency)}
                </span>
              </div>
            ))}
          </div>

          <div className="hidden lg:block flex-shrink-0 text-right border-l border-[#E1E6EB] pl-6">
            <div className="text-xs text-gray-500">Total Revenue</div>
            <div className="text-2xl font-bold text-[#0075DD] mt-1">
              {formatCurrency(totalClientRevenue, currency)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface SpendingWidgetProps {
  currency: string
  totalSpending: number
  spendingRangeKey?: DateRangeKey
  spendingRangeLabel?: string
}

export function SpendingWidget({
  currency,
  totalSpending,
  spendingRangeKey,
  spendingRangeLabel,
}: SpendingWidgetProps) {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-[#001B40]">Spending</h2>
          {spendingRangeLabel && spendingRangeKey && (
            <DateRangeSelector
              paramName="spendingRange"
              selected={spendingRangeKey}
              triggerLabel={spendingRangeLabel}
            />
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 py-4">
        {totalSpending === 0 && (
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-6 h-6 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 11V7a4 4 0 00-8 0v4M5 9h14l-1 11H6L5 9z"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-500">
              No transactions found. Adjust the date range or try again.
            </p>
          </div>
        )}
        <div className="text-right shrink-0">
          <div className="text-xl sm:text-2xl font-bold text-[#0075DD] break-words">
            {formatCurrency(totalSpending, currency)}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">total spending</div>
        </div>
      </div>
    </div>
  )
}

export function BankConnectionsWidget() {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 sm:p-6">
      <h2 className="text-base font-semibold text-[#001B40] mb-4">
        Bank Connections
      </h2>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-[#E3F0FF] flex items-center justify-center flex-shrink-0">
            <svg
              className="w-6 h-6 text-[#0075DD]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 10h18M5 10V6a2 2 0 012-2h10a2 2 0 012 2v4m-7 10h.01M12 20h.01M3 10v8a2 2 0 002 2h14a2 2 0 002-2v-8"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0 sm:hidden">
            <div className="text-sm font-medium text-[#001B40]">
              Save time by connecting your bank
            </div>
          </div>
        </div>
        <div className="hidden sm:block flex-1 min-w-0">
          <div className="text-sm font-medium text-[#001B40]">
            Save time by connecting your bank
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Get transactions automatically imported by connecting your bank or credit card account.
          </div>
        </div>
        <div className="text-xs text-gray-500 sm:hidden">
          Get transactions automatically imported by connecting your bank or credit card account.
        </div>
        <button
          disabled
          title="Coming soon"
          className="px-4 py-2 text-xs font-medium rounded border border-gray-300 bg-white text-gray-500 cursor-not-allowed whitespace-nowrap self-start sm:self-auto"
        >
          Connect a Bank
        </button>
      </div>
    </div>
  )
}

export function UnbilledTimeWidget() {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[#001B40]">Unbilled Time</h2>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-8">
        <div className="w-28 h-28 flex-shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="40" fill="#F3F4F6" />
            <circle cx="50" cy="50" r="16" fill="#FFFFFF" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="space-y-2">
            <div className="h-2 bg-gray-100 rounded w-4/5" />
            <div className="h-2 bg-gray-100 rounded w-3/5" />
            <div className="h-2 bg-gray-100 rounded w-2/3" />
          </div>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="text-sm text-gray-500 max-w-[220px]">
            You keep track of time that needs to be billed.
          </p>
        </div>
      </div>
    </div>
  )
}

interface DashboardWidgetsProps {
  revenueByCurrency: Record<string, CurrencyRevenue>
  revenueCurrencies: string[]
  currency: string
  totalSpending: number
  spendingRangeKey?: DateRangeKey
  spendingRangeLabel?: string
}

export default function DashboardWidgets({
  revenueByCurrency,
  revenueCurrencies,
  currency,
  totalSpending,
  spendingRangeKey,
  spendingRangeLabel,
}: DashboardWidgetsProps) {
  return (
    <div className="space-y-6">
      <RevenueByClientWidget
        revenueByCurrency={revenueByCurrency}
        currencies={revenueCurrencies}
        defaultCurrency={currency}
      />
      {/* totalSpending is a GL figure and the GL is CAD, so format it as CAD —
          not the page-level `currency`, which is auto-picked from invoices. */}
      <SpendingWidget
        currency="CAD"
        totalSpending={totalSpending}
        spendingRangeKey={spendingRangeKey}
        spendingRangeLabel={spendingRangeLabel}
      />
      <UnbilledTimeWidget />
    </div>
  )
}
