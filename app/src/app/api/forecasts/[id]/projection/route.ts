import { NextRequest } from 'next/server'
import { readAuth, notFound } from '@/lib/forecasts/api'
import { loadScenario } from '@/lib/forecasts/server'
import { computeForecast } from '@/lib/forecasts/computed'
import { balanceAt, buildEvents, computeBase, pickAnchor, withRunningBalance } from '@/lib/forecasts/dailyBalance'
import { FALLBACK_RATES } from '@/lib/forecasts/currency'
import { getCadRate } from '@/lib/fx'
import type { Rates } from '@/lib/forecasts/types'

type Ctx = { params: Promise<{ id: string }> }

// Machine-readable projection for a scenario — the one call an agent needs to
// answer "what does cash look like on <date>?". Same engine as the UI.
//   ?asOf=YYYY-MM-DD   (default today)   ?horizonDays=N (upcoming events window, default 60)
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await readAuth(request)
  if (denied) return denied
  const { id } = await params
  const data = await loadScenario(id)
  if (!data) return notFound()

  const sp = request.nextUrl.searchParams
  const now = new Date()
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sp.get('asOf') ?? '')
  const asOf = m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const horizonDays = Math.min(365, Math.max(1, parseInt(sp.get('horizonDays') ?? '60', 10) || 60))

  const rates: Rates = { ...FALLBACK_RATES }
  await Promise.all(['USD', 'EUR'].map(async (ccy) => { try { rates[ccy] = (await getCadRate(ccy, now)).rate } catch { /* fallback */ } }))
  for (const [ccy, v] of Object.entries(data.rateOverrides)) rates[ccy] = v

  const c = computeForecast(data, rates, now)
  const events = buildEvents(data, rates)
  const anchor = pickAnchor(data)
  const base = computeBase(events, anchor)
  const annotated = withRunningBalance(events, base)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const horizonEnd = todayStart + horizonDays * 86400000
  const upcoming = annotated.filter((e) => e.t >= todayStart && e.t <= horizonEnd)
  const lowAhead = upcoming.reduce<{ date: string; balance: number } | null>((low, e) => (!low || e.balance < low.balance ? { date: e.date.toISOString().slice(0, 10), balance: Math.round(e.balance) } : low), null)

  const linkedRows = (section: 'income' | 'expenses') => Object.keys(data.linked[section] ?? {}).filter((k) => !k.startsWith('_'))
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  return Response.json({
    scenario: { id: data.id, name: data.name, kind: data.kind, booksLinked: data.booksLinked, months: data.months, view: { from: data.viewFrom, to: data.viewTo } },
    rates,
    asOf: iso(asOf),
    expectedBalance: Math.round(balanceAt(base, events, asOf)),
    anchor: anchor ? { date: iso(anchor.date), amount: anchor.amount, source: data.linkedBank && anchor.monthIdx === data.linkedBank.monthIndex && !data.bankBalances[String(anchor.monthIdx)] ? 'books' : 'manual' } : null,
    lowPointAhead: lowAhead,
    monthly: data.months.map((month, i) => ({ month, income: Math.round(c.totalIncome[i]), expenses: Math.round(c.totalExpenses[i]), net: Math.round(c.netSavings[i]), endingBalance: Math.round(c.endingBalance[i]) })),
    summaryForView: { sumIncome: Math.round(c.sumIncome), sumExpenses: Math.round(c.sumExpenses), sumNet: Math.round(c.sumNet), savingsRate: Math.round(c.savingsRate * 10) / 10, lastBalance: Math.round(c.lastBalance) },
    upcomingEvents: upcoming.map((e) => ({ date: iso(e.date), label: e.label, amount: Math.round(e.amount), balanceAfter: Math.round(e.balance), section: e.section })),
    rows: {
      income: Object.keys(data.income).map((k) => ({ name: k, linked: data.linked.income?.[k] ?? null, currency: data.incomeCurrencies[k] ?? 'CAD', monthly: data.months.map((_, i) => Math.round(Number(data.income[k][i]) || 0)) })),
      expenses: Object.entries(data.expenses).filter(([k, v]) => v && !k.startsWith('_')).map(([k, v]) => ({ name: k, linked: data.linked.expenses?.[k] ?? null, monthly: data.months.map((_, i) => Math.round(Number(v![i]) || 0)) })),
      linkedIncomeRows: linkedRows('income'),
      linkedExpenseRows: linkedRows('expenses'),
    },
    debts: Object.keys(data.receivables).map((k) => ({ name: k, currentBalance: Math.round((c.debtBalances[k] || [])[c.todayIdx] || 0), settings: data.debtSettings[k] })),
    assets: Object.entries(data.assets).map(([k, a]) => ({ name: k, ...a })),
    netWorth: Math.round(c.netWorth),
    notes: [
      'Amounts are CAD. Formula cells are already resolved in monthly totals; per-row monthly arrays show literal values only.',
      data.booksLinked ? 'Income rows = active Books clients (invoiced this or last month): collected payments as actuals, open invoices on expected pay date (client average days-to-pay, else due date), drafts and recurring templates projected. Expense rows = open bills by due date, recurring templates/expenses, and categorized spend at a trailing 3-month average.' : 'Manual scenario: values are user-entered.',
    ],
  })
}
