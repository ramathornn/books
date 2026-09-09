// Client-safe tax arithmetic shared by the server-side projections
// (lib/forecasts/taxes.ts) and the what-if calculator on the Taxes page.
//
// Rates come from the app's own T1/T2 tables, so a what-if and the projection
// always agree on brackets, BPA and dividend credits.

import { getRateTable as t1Rates } from '@/lib/tax/t1/rates'
import { getRateTable as t2Rates } from '@/lib/tax/t2/rates'

export const r0 = (n: number) => Math.round(n)

/** Gross-up factors that turn actual dividends into taxable dividends. */
export const GROSS_UP = { eligible: 1.38, nonEligible: 1.15 }

export interface TaxTier { rate: number; from: number; to: number; amount: number; tax: number }

export function bracketTax(income: number, brackets: { rate: number; upTo: number }[]): { tax: number; lines: TaxTier[] } {
  let prev = 0
  let tax = 0
  const lines: TaxTier[] = []
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

export function bpaFor(income: number, bpa: { max: number; min: number; phaseOut: { start: number; end: number } | null }): number {
  if (!bpa.phaseOut) return bpa.max
  if (income <= bpa.phaseOut.start) return bpa.max
  if (income >= bpa.phaseOut.end) return bpa.min
  const f = (income - bpa.phaseOut.start) / (bpa.phaseOut.end - bpa.phaseOut.start)
  return bpa.max - (bpa.max - bpa.min) * f
}

// ─── What-if lines ──────────────────────────────────────────────────────────

export const PERSONAL_LINE_TYPES = [
  'employment', 'selfEmployment', 'interest', 'other',
  'eligibleDividend', 'nonEligibleDividend', 'capitalGain',
  'rrspDeduction', 'otherDeduction',
] as const
export const BUSINESS_LINE_TYPES = ['revenue', 'expense'] as const
export const WHAT_IF_LINE_TYPES = [...PERSONAL_LINE_TYPES, ...BUSINESS_LINE_TYPES] as const
export type WhatIfLineType = (typeof WHAT_IF_LINE_TYPES)[number]

export interface WhatIfLine { type: WhatIfLineType; label: string; amount: number }

export const LINE_META: Record<WhatIfLineType, { label: string; hint: string; deduction?: boolean }> = {
  employment: { label: 'Employment (T4)', hint: 'Salary and wages — fully taxable' },
  selfEmployment: { label: 'Self-employment', hint: 'Net business income — fully taxable (CPP not modelled)' },
  interest: { label: 'Interest', hint: 'Interest and most investment income — fully taxable' },
  other: { label: 'Other income', hint: 'Pension, T4A, rental and anything else fully taxable' },
  eligibleDividend: { label: 'Eligible dividends', hint: 'Actual amount; grossed up 38% with the eligible dividend tax credit' },
  nonEligibleDividend: { label: 'Non-eligible dividends', hint: 'Actual amount; grossed up 15% with the non-eligible dividend tax credit' },
  capitalGain: { label: 'Capital gains', hint: 'Full gain; half is taxable' },
  rrspDeduction: { label: 'RRSP deduction', hint: 'Reduces net income', deduction: true },
  otherDeduction: { label: 'Other deduction', hint: 'Any other deduction from income', deduction: true },
  revenue: { label: 'Revenue', hint: 'Sales and other corporate income' },
  expense: { label: 'Expense', hint: 'Deductible corporate expense', deduction: true },
}

export interface WhatIfResult {
  kind: 'personal' | 'corporate'
  year: number
  province: string
  rateVersion: string
  /** Income before deductions, after gross-ups and the capital-gains inclusion. */
  totalIncome: number
  deductions: number
  taxableIncome: number
  totalTax: number
  effectiveRate: number
  monthlySetAside: number
  afterTax: number
  breakdown: { label: string; amount: number; detail?: string }[]
  tiers: { jurisdiction: string; rate: number; from: number; to: number; amount: number; tax: number }[]
  notes: string[]
}

const sumOf = (lines: WhatIfLine[], type: WhatIfLineType) =>
  lines.filter((l) => l.type === type).reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0)

/** Tax on a hypothetical year, using the same tables as the projections. */
export function computeWhatIf(lines: WhatIfLine[], kind: 'personal' | 'business', year: number, province: string): WhatIfResult {
  return kind === 'business' ? corporateWhatIf(lines, year, province) : personalWhatIf(lines, year, province)
}

function personalWhatIf(lines: WhatIfLine[], year: number, province: string): WhatIfResult {
  const table = t1Rates(year, province)
  const ordinary = sumOf(lines, 'employment') + sumOf(lines, 'selfEmployment') + sumOf(lines, 'interest') + sumOf(lines, 'other')
  const actualEligible = sumOf(lines, 'eligibleDividend')
  const actualNonEligible = sumOf(lines, 'nonEligibleDividend')
  const taxableEligible = actualEligible * GROSS_UP.eligible
  const taxableNonEligible = actualNonEligible * GROSS_UP.nonEligible
  const grossGains = sumOf(lines, 'capitalGain')
  const taxableGains = grossGains * 0.5

  const totalIncome = ordinary + taxableEligible + taxableNonEligible + taxableGains
  const deductions = sumOf(lines, 'rrspDeduction') + sumOf(lines, 'otherDeduction')
  const taxableIncome = Math.max(0, totalIncome - deductions)

  const fed = bracketTax(taxableIncome, table.federal.brackets)
  const prov = bracketTax(taxableIncome, table.provincial.brackets)
  const fedDtc = taxableEligible * table.federal.dtc.eligible + taxableNonEligible * table.federal.dtc.nonEligible
  const provDtc = taxableEligible * table.provincial.dtc.eligible + taxableNonEligible * table.provincial.dtc.nonEligible
  const fedTax = Math.max(0, fed.tax - bpaFor(taxableIncome, table.federal.bpa) * table.federal.creditRate - fedDtc)
  const provTax = Math.max(0, prov.tax - bpaFor(taxableIncome, table.provincial.bpa) * table.provincial.creditRate - provDtc)
  const total = fedTax + provTax
  // Cash actually received, not the grossed-up figure.
  const cashIn = ordinary + actualEligible + actualNonEligible + grossGains

  return {
    kind: 'personal',
    year,
    province: table.province,
    rateVersion: table.rateVersion,
    totalIncome: r0(totalIncome),
    deductions: r0(deductions),
    taxableIncome: r0(taxableIncome),
    totalTax: r0(total),
    effectiveRate: cashIn > 0 ? Math.round((total / cashIn) * 1000) / 10 : 0,
    monthlySetAside: r0(total / 12),
    afterTax: r0(cashIn - total),
    breakdown: [
      { label: 'Ordinary income', amount: r0(ordinary) },
      ...(actualEligible ? [{ label: 'Eligible dividends (grossed up)', amount: r0(taxableEligible), detail: `${fmt(actualEligible)} actual × 1.38` }] : []),
      ...(actualNonEligible ? [{ label: 'Non-eligible dividends (grossed up)', amount: r0(taxableNonEligible), detail: `${fmt(actualNonEligible)} actual × 1.15` }] : []),
      ...(grossGains ? [{ label: 'Taxable capital gains', amount: r0(taxableGains), detail: `${fmt(grossGains)} gain × 50%` }] : []),
      ...(deductions ? [{ label: 'Deductions', amount: -r0(deductions) }] : []),
      { label: 'Taxable income', amount: r0(taxableIncome) },
      { label: 'Federal tax', amount: r0(fedTax), detail: fedDtc ? `after ${fmt(fedDtc)} dividend credit` : undefined },
      { label: `${table.province} tax`, amount: r0(provTax), detail: provDtc ? `after ${fmt(provDtc)} dividend credit` : undefined },
    ],
    tiers: [
      ...fed.lines.map((l) => ({ jurisdiction: 'Federal', ...l })),
      ...prov.lines.map((l) => ({ jurisdiction: table.province, ...l })),
    ],
    notes: [
      'Dividends are grossed up and credited; capital gains are half-taxable. CPP/EI, RRSP room limits and other credits are not modelled.',
      `Effective rate is tax over cash received (${fmt(cashIn)}), not over the grossed-up figure.`,
      `Rates: Books T1 tables ${table.rateVersion} (${table.province}).`,
    ],
  }
}

function corporateWhatIf(lines: WhatIfLine[], year: number, province: string): WhatIfResult {
  const table = t2Rates(year, province)
  const revenue = sumOf(lines, 'revenue')
  const expenses = sumOf(lines, 'expense')
  const net = Math.max(0, revenue - expenses)
  const limit = Math.min(table.federal.businessLimit, table.alberta.businessLimit)
  const sbd = Math.min(net, limit)
  const general = Math.max(0, net - limit)
  const fedSbd = sbd * table.federal.netSmallBusinessRate
  const fedGen = general * table.federal.netGeneralRate
  const abSbd = sbd * table.alberta.smallBusinessRate
  const abGen = general * table.alberta.generalRate
  const total = fedSbd + fedGen + abSbd + abGen

  return {
    kind: 'corporate',
    year,
    province: table.province,
    rateVersion: table.rateVersion,
    totalIncome: r0(revenue),
    deductions: r0(expenses),
    taxableIncome: r0(net),
    totalTax: r0(total),
    effectiveRate: net > 0 ? Math.round((total / net) * 1000) / 10 : 0,
    monthlySetAside: r0(total / 12),
    afterTax: r0(net - total),
    breakdown: [
      { label: 'Revenue', amount: r0(revenue) },
      { label: 'Expenses', amount: -r0(expenses) },
      { label: 'Net income', amount: r0(net) },
      { label: 'Federal — small business', amount: r0(fedSbd), detail: `${(table.federal.netSmallBusinessRate * 100).toFixed(1)}% on ${fmt(sbd)}` },
      ...(general ? [{ label: 'Federal — general', amount: r0(fedGen), detail: `${(table.federal.netGeneralRate * 100).toFixed(1)}% on ${fmt(general)}` }] : []),
      { label: `${table.province} — small business`, amount: r0(abSbd), detail: `${(table.alberta.smallBusinessRate * 100).toFixed(1)}% on ${fmt(sbd)}` },
      ...(general ? [{ label: `${table.province} — general`, amount: r0(abGen), detail: `${(table.alberta.generalRate * 100).toFixed(1)}% on ${fmt(general)}` }] : []),
    ],
    tiers: [],
    notes: [
      'Net income = revenue minus expenses. CCA, GRIP/RDTOH, passive-income grinds and instalments are not modelled.',
      `Small business limit ${fmt(limit)}; income above it is taxed at the general rate.`,
      `Rates: Books T2 tables ${table.rateVersion} (${table.province}).`,
    ],
  }
}

const fmt = (n: number) => n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
