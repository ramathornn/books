// Server-side helpers: load a scenario from the relational tables into the
// client ForecastData shape, and bootstrap the default scenarios.
import 'server-only'
import prisma from '@/lib/prisma'
import type { Asset, CellValue, DebtSettings, FlowDays, ForecastData, ForecastIds, ScenarioSummary, Section } from './types'
import { buildMonths } from './months'

export const SECTION_TO_DB: Record<Section, string> = { income: 'income', expenses: 'expense', receivables: 'debt' }
export const DB_TO_SECTION: Record<string, Section> = { income: 'income', expense: 'expenses', debt: 'receivables' }

const dec = (v: { toNumber(): number } | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : v.toNumber()

/** Ensure the two default scenarios exist (Personal + Business), starting Jan of the current year. */
export async function ensureDefaultScenarios(): Promise<ScenarioSummary[]> {
  const existing = await prisma.forecastScenario.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, kind: true } })
  if (existing.length > 0) return existing.map(toSummary)
  const year = new Date().getFullYear()
  await prisma.forecastScenario.createMany({
    data: [
      { name: 'Personal', kind: 'personal', startYear: year, startMonth: 0, monthCount: 12, viewFrom: 0, viewTo: 11, sortOrder: 0 },
      { name: 'Business', kind: 'business', startYear: year, startMonth: 0, monthCount: 12, viewFrom: 0, viewTo: 11, sortOrder: 1 },
    ],
  })
  const rows = await prisma.forecastScenario.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, kind: true } })
  return rows.map(toSummary)
}

function toSummary(s: { id: string; name: string; kind: string }): ScenarioSummary {
  return { id: s.id, name: s.name, kind: s.kind === 'business' ? 'business' : 'personal' }
}

export async function loadScenario(id: string): Promise<ForecastData | null> {
  const s = await prisma.forecastScenario.findUnique({
    where: { id },
    include: {
      categories: { orderBy: { sortOrder: 'asc' } },
      rows: {
        orderBy: { sortOrder: 'asc' },
        include: {
          cells: true,
          flowDays: true,
          linkedExpense: { select: { name: true } },
          linkedAsset: { select: { name: true } },
        },
      },
      assets: { orderBy: { sortOrder: 'asc' }, include: { linkedDebt: { select: { name: true } } } },
      bankBalances: true,
      rateOverrides: true,
    },
  })
  if (!s) return null

  const months = buildMonths(s.startYear, s.startMonth, s.monthCount)
  const n = months.length
  const ids: ForecastIds = { rows: { income: {}, expenses: {}, receivables: {} }, categories: {}, assets: {} }

  const series = (cells: { monthIndex: number; amount: unknown; formula: string | null }[]): CellValue[] => {
    const arr: CellValue[] = new Array(n).fill(0)
    for (const c of cells) {
      if (c.monthIndex < 0 || c.monthIndex >= n) continue
      arr[c.monthIndex] = c.formula ?? dec(c.amount as { toNumber(): number })
    }
    return arr
  }

  const income: ForecastData['income'] = {}
  const incomeCurrencies: Record<string, string> = {}
  const receivables: ForecastData['receivables'] = {}
  const debtSettings: Record<string, DebtSettings> = {}
  const flowDays: FlowDays = {}
  const hidden: ForecastData['_hidden'] = {}

  const noteFlow = (section: Section, name: string, fds: { monthIndex: number; kind: string; day: number | null }[]) => {
    if (!fds.length) return
    const rec = { schedule: [] as { from: number; day: number | 'last' }[], overrides: {} as Record<string, number | 'last'> }
    for (const f of fds) {
      const day = f.day === null ? ('last' as const) : f.day
      if (f.kind === 'schedule') rec.schedule.push({ from: f.monthIndex, day })
      else rec.overrides[String(f.monthIndex)] = day
    }
    rec.schedule.sort((a, b) => a.from - b.from)
    ;(flowDays[section] ||= {})[name] = rec
  }
  const noteHidden = (section: Section, name: string, h: boolean) => {
    if (h) (hidden[section] ||= {})[name] = true
  }

  for (const r of s.rows) {
    if (r.section === 'income') {
      income[r.name] = series(r.cells)
      ids.rows.income[r.name] = r.id
      if (r.currency && r.currency !== 'CAD') incomeCurrencies[r.name] = r.currency
      noteFlow('income', r.name, r.flowDays)
      noteHidden('income', r.name, r.hidden)
    } else if (r.section === 'debt') {
      receivables[r.name] = series(r.cells)
      ids.rows.receivables[r.name] = r.id
      debtSettings[r.name] = {
        type: r.debtType === 'loan' ? 'loan' : 'simple',
        interestRate: dec(r.interestRate),
        amortizationMonths: r.amortizationMonths,
        remainingMonths: r.remainingMonths,
        linkedExpense: r.linkedExpense?.name ?? null,
        linkedAsset: r.linkedAsset?.name ?? null,
      }
      noteHidden('receivables', r.name, r.hidden)
    }
  }

  // Expenses: category headers ("_Name": null) followed by their rows, then uncategorized rows.
  const expenses: ForecastData['expenses'] = {}
  const expenseRows = s.rows.filter((r) => r.section === 'expense')
  const byCat = new Map<string | null, typeof expenseRows>()
  for (const r of expenseRows) {
    const list = byCat.get(r.categoryId) ?? []
    list.push(r)
    byCat.set(r.categoryId, list)
  }
  const emit = (r: (typeof expenseRows)[number]) => {
    expenses[r.name] = series(r.cells)
    ids.rows.expenses[r.name] = r.id
    noteFlow('expenses', r.name, r.flowDays)
    noteHidden('expenses', r.name, r.hidden)
  }
  for (const r of byCat.get(null) ?? []) emit(r)
  for (const c of s.categories) {
    expenses[`_${c.name}`] = null
    ids.categories[c.name] = c.id
    for (const r of byCat.get(c.id) ?? []) emit(r)
  }

  const assets: Record<string, Asset> = {}
  for (const a of s.assets) {
    assets[a.name] = { value: dec(a.value), type: (a.type as Asset['type']) || 'other', linkedDebt: a.linkedDebt?.name ?? null }
    ids.assets[a.name] = a.id
  }

  const bankBalances: ForecastData['bankBalances'] = {}
  for (const b of s.bankBalances) bankBalances[String(b.monthIndex)] = { amount: dec(b.amount), day: b.day }

  const rateOverrides: Record<string, number> = {}
  for (const r of s.rateOverrides) rateOverrides[r.currency] = dec(r.rate)

  return {
    id: s.id,
    name: s.name,
    kind: s.kind === 'business' ? 'business' : 'personal',
    months,
    viewFrom: Math.min(s.viewFrom, n - 1),
    viewTo: Math.min(s.viewTo, n - 1),
    income,
    expenses,
    receivables,
    debtSettings,
    assets,
    bankBalances,
    flowDays,
    incomeCurrencies,
    _hidden: hidden,
    rateOverrides,
    ids,
  }
}

/** Extend a scenario's month range so that index `toIndex` exists. */
export async function ensureMonthCount(id: string, toIndex: number): Promise<void> {
  const s = await prisma.forecastScenario.findUnique({ where: { id }, select: { monthCount: true } })
  if (!s) return
  if (toIndex + 1 > s.monthCount) {
    await prisma.forecastScenario.update({ where: { id }, data: { monthCount: toIndex + 1 } })
  }
}
