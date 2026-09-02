// Derived values for a scenario (ported from WealthPilot's store.computed).
// Pure: same data + rates in → same numbers out. Everything in CAD.

import type { ForecastData, Rates } from './types'
import { convertToCAD } from './currency'
import { resolveValue } from './formula'
import { currentMonthIndex } from './months'

export interface CategoryTotal { name: string; totals: number[]; viewTotals: number[]; total: number }
export interface AssetView { name: string; value: number; linkedDebt: string | null; linkedBalance: number; equity: number; type: string }

export interface Computed {
  from: number
  to: number
  todayIdx: number
  viewMonths: string[]
  totalIncome: number[]
  totalExpenses: number[]
  netSavings: number[]
  endingBalance: number[]
  viewIncome: number[]
  viewExpenses: number[]
  viewNet: number[]
  viewBalance: number[]
  sumIncome: number
  sumExpenses: number
  sumNet: number
  avgIncome: number
  avgExpenses: number
  lastBalance: number
  totalDebt: number
  savingsRate: number
  expenseCategories: Record<string, { name: string; data: (number | string)[] }[]>
  categoryTotals: CategoryTotal[]
  growth: number[]
  ratio: number[]
  totalAssetValue: number
  totalLiabilities: number
  netWorth: number
  assetsByType: Record<string, AssetView[]>
  debtBalances: Record<string, number[]>
}

export function computeForecast(data: ForecastData, rates: Rates, now: Date = new Date()): Computed {
  const { months, income, expenses, receivables, viewFrom, viewTo } = data
  const from = Math.min(viewFrom, Math.max(0, months.length - 1))
  const to = Math.min(viewTo, months.length - 1)
  const todayIdx = currentMonthIndex(months, now)
  const currencies = data.incomeCurrencies || {}

  const totalIncome = months.map((_, i) => {
    let sum = 0
    for (const [k, arr] of Object.entries(income)) {
      if (arr && !k.startsWith('_')) sum += convertToCAD(resolveValue(arr[i], data, i), currencies[k] || 'CAD', rates)
    }
    return sum
  })

  const totalExpenses = months.map((_, i) => {
    let sum = 0
    for (const [k, arr] of Object.entries(expenses)) {
      if (arr && !k.startsWith('_')) sum += resolveValue(arr[i], data, i)
    }
    return sum
  })

  const netSavings = totalIncome.map((v, i) => v - totalExpenses[i])

  const endingBalance: number[] = []
  const snapshots = data.bankBalances || {}
  netSavings.forEach((v, i) => {
    const snap = snapshots[String(i)]
    if (snap) endingBalance.push(snap.amount)
    else if (i === 0) endingBalance.push(v)
    else endingBalance.push(endingBalance[i - 1] + v)
  })

  const viewMonths = months.slice(from, to + 1)
  const viewIncome = totalIncome.slice(from, to + 1)
  const viewExpenses = totalExpenses.slice(from, to + 1)
  const viewNet = netSavings.slice(from, to + 1)
  const viewBalance = endingBalance.slice(from, to + 1)

  const sumIncome = viewIncome.reduce((a, b) => a + b, 0)
  const sumExpenses = viewExpenses.reduce((a, b) => a + b, 0)
  const sumNet = sumIncome - sumExpenses
  const nonZeroInc = viewIncome.filter((v) => v > 0)
  const avgIncome = nonZeroInc.length ? sumIncome / nonZeroInc.length : 0
  const avgExpenses = viewExpenses.length ? sumExpenses / viewExpenses.length : 0
  const lastBalance = endingBalance[to] ?? 0

  // Running debt balances
  const dSettings = data.debtSettings || {}
  const debtBalances: Record<string, number[]> = {}
  for (const [name, arr] of Object.entries(receivables)) {
    const settings = dSettings[name]
    const hasLinkedExpense = !!settings?.linkedExpense
    const hasInterest = (settings?.interestRate ?? 0) > 0
    const hasAmortization = settings?.type === 'loan' && hasInterest && !!(settings?.amortizationMonths || settings?.remainingMonths)

    if (!hasLinkedExpense && !hasAmortization && !hasInterest) {
      const balances = new Array<number>(months.length).fill(0)
      for (let i = 0; i < months.length; i++) {
        const v = resolveValue(arr[i], data, i)
        balances[i] = i === 0 || v > 0 ? v : Math.max(0, balances[i - 1] + v)
      }
      debtBalances[name] = balances
      continue
    }

    let startIdx = 0
    for (let i = 0; i < months.length; i++) {
      if (resolveValue(arr[i], data, i) > 0) { startIdx = i; break }
    }
    const startingBalance = resolveValue(arr[startIdx], data, startIdx)
    const balances = new Array<number>(months.length).fill(0)
    const expenseArr = hasLinkedExpense && settings ? expenses[settings.linkedExpense as string] : null
    const monthlyRate = hasInterest && settings ? settings.interestRate / 100 / 12 : 0

    if (expenseArr) {
      const firstPayment = resolveValue(expenseArr[startIdx], data, startIdx)
      balances[startIdx] = Math.max(0, startingBalance - firstPayment)
    } else {
      balances[startIdx] = startingBalance
    }

    let amortPayment = 0
    if (hasAmortization && !hasLinkedExpense && settings) {
      const n = settings.remainingMonths || settings.amortizationMonths || 1
      amortPayment = monthlyRate > 0
        ? (startingBalance * monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1)
        : startingBalance / n
    }

    for (let i = startIdx + 1; i < months.length; i++) {
      let prev = balances[i - 1]
      if (monthlyRate > 0) prev = prev * (1 + monthlyRate)
      if (expenseArr) {
        balances[i] = Math.max(0, prev - resolveValue(expenseArr[i], data, i))
      } else if (hasAmortization) {
        balances[i] = Math.max(0, prev - amortPayment)
      } else {
        const raw = resolveValue(arr[i], data, i)
        if (raw > 0) balances[i] = raw
        else if (raw < 0) balances[i] = Math.max(0, prev + raw)
        else balances[i] = prev
      }
    }
    debtBalances[name] = balances
  }

  const totalDebt = Object.values(debtBalances).reduce((s, b) => s + Math.max(0, b[todayIdx] || 0), 0)
  const savingsRate = sumIncome > 0 ? (sumNet / sumIncome) * 100 : 0

  const expenseCategories: Computed['expenseCategories'] = {}
  let currentCat = 'Uncategorized'
  for (const [k, arr] of Object.entries(expenses)) {
    if (k.startsWith('_')) { currentCat = k.slice(1); continue }
    ;(expenseCategories[currentCat] ||= []).push({ name: k, data: arr || new Array(months.length).fill(0) })
  }

  const categoryTotals: CategoryTotal[] = Object.entries(expenseCategories).map(([name, items]) => {
    const totals = months.map((_, i) => items.reduce((s, item) => s + resolveValue(item.data[i], data, i), 0))
    const viewTotals = totals.slice(from, to + 1)
    return { name, totals, viewTotals, total: viewTotals.reduce((a, b) => a + b, 0) }
  })

  const growth = viewIncome.map((v, i) => (i === 0 ? 0 : viewIncome[i - 1] !== 0 ? ((v - viewIncome[i - 1]) / viewIncome[i - 1]) * 100 : 0))
  const ratio = viewIncome.map((v, i) => (viewExpenses[i] !== 0 ? v / viewExpenses[i] : 0))

  const assets = data.assets || {}
  const totalAssetValue = Object.values(assets).reduce((s, a) => s + (a.value || 0), 0)
  const totalLiabilities = totalDebt
  const netWorth = totalAssetValue - totalLiabilities

  const assetsByType: Record<string, AssetView[]> = {}
  for (const [name, a] of Object.entries(assets)) {
    const t = a.type || 'other'
    const linkedBalance = a.linkedDebt && debtBalances[a.linkedDebt] ? Math.max(0, debtBalances[a.linkedDebt][todayIdx] || 0) : 0
    ;(assetsByType[t] ||= []).push({ name, value: a.value || 0, linkedDebt: a.linkedDebt, linkedBalance, equity: (a.value || 0) - linkedBalance, type: t })
  }

  return {
    from, to, todayIdx, viewMonths,
    totalIncome, totalExpenses, netSavings, endingBalance,
    viewIncome, viewExpenses, viewNet, viewBalance,
    sumIncome, sumExpenses, sumNet, avgIncome, avgExpenses,
    lastBalance, totalDebt, savingsRate,
    expenseCategories, categoryTotals, growth, ratio,
    totalAssetValue, totalLiabilities, netWorth, assetsByType,
    debtBalances,
  }
}

/** Ending balance series for another scenario (Overview's "other mode" widget). */
export function computeEndingBalance(data: ForecastData, rates: Rates): number[] {
  return computeForecast(data, rates).endingBalance
}

export function fmtMoney(n: number | null | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '$0'
  return (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString()
}

export function fmtShort(n: number | null | undefined): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '$0'
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(a % 1000 === 0 ? 0 : 1)}k`
  return `${sign}$${Math.round(a).toLocaleString()}`
}
