// Very basic projected tax bill for a scenario, built on Books' own T1/T2 rate
// tables so the forecast and the filing modules can never disagree on rates.
// Personal scenario → personal income tax on the year's income (federal + AB).
// Business scenario → corporate tax on the fiscal year's net income (SBD + general).
import 'server-only'
import { getRateTable as t1Rates } from '@/lib/tax/t1/rates'
import { getRateTable as t2Rates } from '@/lib/tax/t2/rates'
import type { Computed } from './computed'
import type { ForecastData } from './types'
import { parseMonthLabel } from './months'

const r0 = (n: number) => Math.round(n)

function bracketTax(income: number, brackets: { rate: number; upTo: number }[]): { tax: number; lines: { rate: number; from: number; to: number; amount: number; tax: number }[] } {
  let prev = 0
  let tax = 0
  const lines: { rate: number; from: number; to: number; amount: number; tax: number }[] = []
  for (const b of brackets) {
    if (income <= prev) break
    const slice = Math.min(income, b.upTo) - prev
    const t = slice * b.rate
    lines.push({ rate: b.rate, from: prev, to: b.upTo, amount: r0(slice), tax: r0(t) })
    tax += t
    prev = b.upTo
  }
  return { tax, lines }
}

function bpaFor(income: number, bpa: { max: number; min: number; phaseOut: { start: number; end: number } | null }): number {
  if (!bpa.phaseOut) return bpa.max
  if (income <= bpa.phaseOut.start) return bpa.max
  if (income >= bpa.phaseOut.end) return bpa.min
  const f = (income - bpa.phaseOut.start) / (bpa.phaseOut.end - bpa.phaseOut.start)
  return bpa.max - (bpa.max - bpa.min) * f
}

export interface TaxProjection {
  kind: 'personal' | 'corporate'
  year: number
  label: string
  province: string
  rateVersion: string
  /** Month labels included, and how many of the 12 were inside the workbook. */
  months: string[]
  coverage: { included: number; of: number }
  income: number
  expenses: number
  taxableIncome: number
  totalTax: number
  effectiveRate: number
  monthlySetAside: number
  breakdown: { label: string; amount: number; detail?: string }[]
  notes: string[]
}

/** Months of the workbook that fall inside [start, end] (year*12+month keys, inclusive). */
function monthsIn(data: ForecastData, startKey: number, endKey: number): number[] {
  const out: number[] = []
  data.months.forEach((m, i) => {
    const p = parseMonthLabel(m)
    if (!p) return
    const k = p.year * 12 + p.month
    if (k >= startKey && k <= endKey) out.push(i)
  })
  return out
}

export function projectPersonalTax(data: ForecastData, c: Computed, year: number, province: string): TaxProjection {
  const table = t1Rates(year, province)
  const idx = monthsIn(data, year * 12, year * 12 + 11)
  const income = idx.reduce((s, i) => s + c.totalIncome[i], 0)
  const fed = bracketTax(income, table.federal.brackets)
  const prov = bracketTax(income, table.provincial.brackets)
  const fedCredit = bpaFor(income, table.federal.bpa) * table.federal.creditRate
  const provCredit = bpaFor(income, table.provincial.bpa) * table.provincial.creditRate
  const fedTax = Math.max(0, fed.tax - fedCredit)
  const provTax = Math.max(0, prov.tax - provCredit)
  const total = fedTax + provTax
  return {
    kind: 'personal',
    year,
    label: `Projected ${year} personal tax`,
    province: table.province,
    rateVersion: table.rateVersion,
    months: idx.map((i) => data.months[i]),
    coverage: { included: idx.length, of: 12 },
    income: r0(income),
    expenses: 0,
    taxableIncome: r0(income),
    totalTax: r0(total),
    effectiveRate: income > 0 ? Math.round((total / income) * 1000) / 10 : 0,
    monthlySetAside: r0(total / 12),
    breakdown: [
      ...fed.lines.map((l) => ({ label: `Federal ${(l.rate * 100).toFixed(1)}%`, amount: l.tax, detail: `on ${l.amount.toLocaleString()} (${l.from.toLocaleString()} to ${l.to === Infinity ? 'above' : l.to.toLocaleString()})` })),
      { label: 'Federal basic personal amount', amount: -r0(Math.min(fedCredit, fed.tax)) },
      ...prov.lines.map((l) => ({ label: `${table.province} ${(l.rate * 100).toFixed(1)}%`, amount: l.tax, detail: `on ${l.amount.toLocaleString()}` })),
      { label: `${table.province} basic personal amount`, amount: -r0(Math.min(provCredit, prov.tax)) },
    ],
    notes: [
      'Income = every income row in this scenario for the calendar year, in CAD, treated as fully taxable employment-style income.',
      'Ignores CPP/EI, RRSP, dividend tax credits, and other credits. Estimate only; the T1 module does the real return.',
      `Rates: Books T1 tables ${table.rateVersion} (${table.province}). ${year > table.taxYear ? `${year} tables not published yet; using ${table.taxYear}.` : ''}`.trim(),
    ],
  }
}

export function projectCorporateTax(data: ForecastData, c: Computed, fiscalYear: number, fiscalYearEnd: { month: number; day: number }, province: string): TaxProjection {
  const table = t2Rates(fiscalYear, province)
  // FY N ends in fiscalYearEnd.month of year N; starts the following month a year earlier.
  const endKey = fiscalYear * 12 + (fiscalYearEnd.month - 1)
  const startKey = endKey - 11
  const idx = monthsIn(data, startKey, endKey)
  const income = idx.reduce((s, i) => s + c.totalIncome[i], 0)
  const expenses = idx.reduce((s, i) => s + c.totalExpenses[i], 0)
  const net = Math.max(0, income - expenses)
  const limit = Math.min(table.federal.businessLimit, table.alberta.businessLimit)
  const sbd = Math.min(net, limit)
  const general = Math.max(0, net - limit)
  const fedSbd = sbd * table.federal.netSmallBusinessRate
  const fedGen = general * table.federal.netGeneralRate
  const abSbd = sbd * table.alberta.smallBusinessRate
  const abGen = general * table.alberta.generalRate
  const total = fedSbd + fedGen + abSbd + abGen
  const fyLabel = `FY${String(fiscalYear).slice(-2)}`
  return {
    kind: 'corporate',
    year: fiscalYear,
    label: `Projected ${fyLabel} corporate tax`,
    province: table.province,
    rateVersion: table.rateVersion,
    months: idx.map((i) => data.months[i]),
    coverage: { included: idx.length, of: 12 },
    income: r0(income),
    expenses: r0(expenses),
    taxableIncome: r0(net),
    totalTax: r0(total),
    effectiveRate: net > 0 ? Math.round((total / net) * 1000) / 10 : 0,
    monthlySetAside: r0(total / 12),
    breakdown: [
      { label: `Federal small business ${(table.federal.netSmallBusinessRate * 100).toFixed(1)}%`, amount: r0(fedSbd), detail: `on ${r0(sbd).toLocaleString()} (limit ${limit.toLocaleString()})` },
      ...(general > 0 ? [{ label: `Federal general ${(table.federal.netGeneralRate * 100).toFixed(1)}%`, amount: r0(fedGen), detail: `on ${r0(general).toLocaleString()} above the limit` }] : []),
      { label: `${table.province} small business ${(table.alberta.smallBusinessRate * 100).toFixed(1)}%`, amount: r0(abSbd), detail: `on ${r0(sbd).toLocaleString()}` },
      ...(general > 0 ? [{ label: `${table.province} general ${(table.alberta.generalRate * 100).toFixed(1)}%`, amount: r0(abGen), detail: `on ${r0(general).toLocaleString()} above the limit` }] : []),
    ],
    notes: [
      'Net income = income rows minus expense rows for the fiscal year, in CAD. Owner salary paid out of the business reduces it; dividends do not.',
      'Ignores CCA, GRIP/RDTOH, passive-income grinds, and instalments. Estimate only; the T2 module does the real return.',
      `Rates: Books T2 tables ${table.rateVersion} (${table.province}). ${fiscalYear > table.taxationYear ? `${fiscalYear} tables not published yet; using ${table.taxationYear}.` : ''}`.trim(),
    ],
  }
}
