'use client'

import { useEffect, useState } from 'react'
import { useForecast } from '@/components/forecasts/ForecastProvider'
import { AreaChart, CHART_COLORS, DonutChart } from '@/components/forecasts/charts'
import { Card, CategoryBars, Hero, MetricGrid } from '@/components/forecasts/ui'
import { computeEndingBalance, fmtMoney } from '@/lib/forecasts/computed'
import type { ForecastData } from '@/lib/forecasts/types'

export default function OverviewClient() {
  const { data, computed, scenarios, rates } = useForecast()
  const { viewMonths, viewNet, viewBalance, sumIncome, sumExpenses, sumNet, avgIncome, avgExpenses, lastBalance, savingsRate, totalDebt, categoryTotals, ratio, from, to, todayIdx, netWorth, totalAssetValue, debtBalances } = computed
  const [hiddenRecv, setHiddenRecv] = useState<Record<string, boolean>>({})
  const [debtsVisible, setDebtsVisible] = useState(true)
  const [other, setOther] = useState<ForecastData | null>(null)

  // The other scenario's ending balance (WealthPilot's personal/business widget).
  const otherScenario = scenarios.find((s) => s.id !== data.id) ?? null
  useEffect(() => {
    let cancelled = false
    if (!otherScenario) return
    fetch(`/api/forecasts/${otherScenario.id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!cancelled) setOther(d) }).catch(() => { if (!cancelled) setOther(null) })
    return () => { cancelled = true }
  }, [otherScenario?.id, data.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const otherBalance = other && otherScenario && other.id === otherScenario.id ? computeEndingBalance(other, rates) : null
  const otherView = otherBalance ? otherBalance.slice(from, Math.min(to, otherBalance.length - 1) + 1) : []
  const otherLast = otherBalance ? otherBalance[Math.min(to, otherBalance.length - 1)] || 0 : 0

  const receivableCards = Object.keys(data.receivables).map((name, i) => ({ name, current: (debtBalances[name] || [])[todayIdx] || 0, color: CHART_COLORS[(i + 1) % CHART_COLORS.length], hidden: !!hiddenRecv[name] })).filter((r) => r.current > 0)
  const chartRecv = debtsVisible ? receivableCards.filter((r) => !r.hidden) : []
  const areaData = viewMonths.map((month, i) => { const row: Record<string, number | string> = { month, 'Running Balance': viewBalance[i] }; chartRecv.forEach((r) => { row[r.name] = (debtBalances[r.name] || [])[from + i] || 0 }); return row })
  const bestIdx = viewNet.indexOf(Math.max(...viewNet))
  const pos = ratio.filter((r) => r > 0)
  const avgRatio = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 0
  const topCat = [...categoryTotals].sort((a, b) => b.total - a.total)[0]
  const sortedCats = categoryTotals.filter((c) => c.total > 0).sort((a, b) => b.total - a.total)

  return (
    <div>
      <Hero label="Net position" value={fmtMoney(sumNet)} negative={sumNet < 0} badge={`${sumNet >= 0 ? '▲' : '▼'} ${savingsRate.toFixed(1)}%`} badgeTone={sumNet >= 0 ? 'green' : 'red'}
        sub={<>{fmtMoney(sumIncome)} income − {fmtMoney(sumExpenses)} expenses · {viewMonths[0]} to {viewMonths[viewMonths.length - 1]}</>} />

      <Card className="mb-6">
        <AreaChart data={areaData} height={320} areas={[{ dataKey: 'Running Balance', color: CHART_COLORS[0] }, ...chartRecv.map((r) => ({ dataKey: r.name, color: r.color }))]} />
        {receivableCards.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setDebtsVisible((v) => !v)} className={`rounded-full border px-3 py-1 text-[12px] ${debtsVisible ? 'border-gray-300 text-gray-700' : 'border-dashed border-gray-300 text-gray-400'}`}>{debtsVisible ? 'Hide debts' : 'Show debts'}</button>
            {debtsVisible && receivableCards.map((r) => (
              <button key={r.name} type="button" onClick={() => setHiddenRecv((p) => ({ ...p, [r.name]: !p[r.name] }))} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] ${r.hidden ? 'border-dashed border-gray-300 text-gray-400' : 'border-gray-300 text-gray-700'}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: r.hidden ? '#E1E6EB' : r.color }} />{r.name}<span className="text-gray-400">{fmtMoney(r.current)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <MetricGrid metrics={[
        { label: 'Total income', value: fmtMoney(sumIncome), sub: `Avg ${fmtMoney(Math.round(avgIncome))}/mo` },
        { label: 'Total expenses', value: fmtMoney(sumExpenses), sub: `Avg ${fmtMoney(Math.round(avgExpenses))}/mo` },
        { label: 'Net worth', value: fmtMoney(netWorth), sub: `${Object.keys(data.assets).length} assets · ${fmtMoney(totalAssetValue)}`, neg: netWorth < 0 },
        { label: 'End balance', value: fmtMoney(lastBalance), sub: viewMonths[viewMonths.length - 1], neg: lastBalance < 0 },
        { label: 'Savings rate', value: `${savingsRate.toFixed(1)}%`, sub: 'Net / income', neg: savingsRate < 0 },
        { label: 'Outstanding debt', value: fmtMoney(totalDebt), sub: `${receivableCards.length} active` },
        { label: 'I/E ratio', value: `${avgRatio.toFixed(2)}x`, sub: avgRatio >= 1 ? 'Healthy' : 'Below breakeven', neg: avgRatio < 1 },
        { label: 'Best month', value: viewMonths[bestIdx] || '—', sub: `${fmtMoney(viewNet[bestIdx] || 0)} net` },
        { label: 'Top category', value: topCat ? topCat.name : '—', sub: topCat ? fmtMoney(topCat.total) : '' },
      ]} />

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card title={`${data.name} — ending balance`} action={<span className={`text-sm font-semibold tabular-nums ${lastBalance < 0 ? 'text-[#BF2600]' : 'text-gray-900'}`}>{fmtMoney(lastBalance)}</span>}>
          <AreaChart data={viewMonths.map((month, i) => ({ month, Balance: viewBalance[i] }))} areas={[{ dataKey: 'Balance', color: CHART_COLORS[0] }]} height={240} />
        </Card>
        <Card title={`${otherScenario?.name ?? 'Other'} — ending balance`} action={<span className={`text-sm font-semibold tabular-nums ${otherLast < 0 ? 'text-[#BF2600]' : 'text-gray-900'}`}>{fmtMoney(otherLast)}</span>}>
          {otherBalance ? <AreaChart data={viewMonths.map((month, i) => ({ month, Balance: otherView[i] || 0 }))} areas={[{ dataKey: 'Balance', color: CHART_COLORS[3] }]} height={240} /> : <div className="flex h-[240px] items-center justify-center text-sm text-gray-400">Loading…</div>}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card title="Expense categories"><CategoryBars items={sortedCats} colors={CHART_COLORS} /></Card>
        <Card title="Distribution"><DonutChart data={sortedCats.map((c) => ({ name: c.name, value: c.total }))} /></Card>
      </div>
    </div>
  )
}
