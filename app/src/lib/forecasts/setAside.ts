// CRA fiscal-year set-aside: the personal tax you must hold back on the money
// you pull out of the corporation to fund personal spending.
//
// The key point is that this is a GROSS-UP, not a flat percentage of spending.
// To have $E left in hand you must withdraw $G where G - tax(G) = E, so the
// amount to set aside is tax(G) = G - E. At a ~30% average rate that is ~43%
// of spending, not 30%.
//
// Personal tax is progressive, so the set-aside is computed CUMULATIVELY within
// each calendar tax year: January's dollars fall in the lowest bracket and
// December's in the highest. Each month reports the *increment* in tax owed,
// which is why the figure rises through the year and resets every January.
//
// Rates come from the same T1 tables the filing module uses (pure data modules,
// safe to import on the client) so the forecast can never disagree with a
// return. Modelled as NON-ELIGIBLE dividends, the standard owner-manager payout.

import { FEDERAL_2025 } from '@/lib/tax/t1/rates/federal2025'
import { AB_2025 } from '@/lib/tax/t1/rates/ab2025'
import { parseMonthLabel } from './months'

/** Non-eligible dividend factors (mirrors DIVIDEND_RATES in '@/lib/tax/rates'). */
const NON_ELIGIBLE_GROSS_UP = 0.15

type Bracket = { rate: number; upTo: number }

function bracketTax(income: number, brackets: readonly Bracket[]): number {
  let prev = 0
  let tax = 0
  for (const b of brackets) {
    if (income <= prev) break
    tax += (Math.min(income, b.upTo) - prev) * b.rate
    prev = b.upTo
  }
  return tax
}

function bpaFor(income: number, bpa: { max: number; min: number; phaseOut: { start: number; end: number } | null }): number {
  if (!bpa.phaseOut) return bpa.max
  if (income <= bpa.phaseOut.start) return bpa.max
  if (income >= bpa.phaseOut.end) return bpa.min
  const f = (income - bpa.phaseOut.start) / (bpa.phaseOut.end - bpa.phaseOut.start)
  return bpa.max - (bpa.max - bpa.min) * f
}

/**
 * Personal tax on `gross` paid out as non-eligible dividends: gross up, run the
 * federal and Alberta brackets, then subtract the basic personal amount and the
 * dividend tax credit in each jurisdiction.
 *
 * Deliberately ignores CPP and any credit beyond the BPA + DTC, matching the
 * rest of the forecast module — it is a reserve estimate, not a filed return.
 */
export function personalTaxOnDividend(gross: number): number {
  if (gross <= 0) return 0
  const taxable = gross * (1 + NON_ELIGIBLE_GROSS_UP)

  const fedGross = bracketTax(taxable, FEDERAL_2025.brackets)
  const fedCredits = FEDERAL_2025.creditRate * bpaFor(taxable, FEDERAL_2025.bpa) + FEDERAL_2025.dtc.nonEligible * taxable
  const fed = Math.max(0, fedGross - fedCredits)

  const abGross = bracketTax(taxable, AB_2025.brackets)
  const abCredits = AB_2025.creditRate * bpaFor(taxable, AB_2025.bpa) + AB_2025.dtc.nonEligible * taxable
  const ab = Math.max(0, abGross - abCredits)

  return fed + ab
}

/**
 * Withdrawal needed to net `want` after personal tax. Solved by bisection since
 * the gross-up plus progressive brackets have no clean closed form.
 */
export function grossUpForNet(want: number): number {
  if (want <= 0) return 0
  let lo = want
  let hi = want * 3 + 1000
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (mid - personalTaxOnDividend(mid) < want) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Tax to reserve so that `net` is left over after paying it. */
export function setAsideForNet(net: number): number {
  if (net <= 0) return 0
  return grossUpForNet(net) - net
}

/**
 * Per-month set-aside for a run of months, cumulative within each calendar year.
 *
 * `monthLabels` and `expenses` are parallel arrays over the same months. Returns
 * one figure per month: the increase in the year's tax reserve caused by that
 * month's spending.
 *
 * Caveat: a workbook that starts mid-year restarts the year's cumulative total
 * at that month, so it under-reserves for draws already taken earlier that year.
 */
export function monthlySetAside(monthLabels: string[], expenses: number[]): number[] {
  const out = new Array(monthLabels.length).fill(0)
  const cumNetByYear = new Map<number, number>()
  const cumTaxByYear = new Map<number, number>()

  monthLabels.forEach((label, i) => {
    const p = parseMonthLabel(label)
    if (!p) return
    const spend = Math.max(0, expenses[i] ?? 0)
    const net = (cumNetByYear.get(p.year) ?? 0) + spend
    const tax = setAsideForNet(net)
    out[i] = Math.max(0, tax - (cumTaxByYear.get(p.year) ?? 0))
    cumNetByYear.set(p.year, net)
    cumTaxByYear.set(p.year, tax)
  })

  return out
}
