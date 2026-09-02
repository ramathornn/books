'use client'

// Client store for one forecast scenario. Holds the WealthPilot-shaped data,
// applies every edit optimistically, then persists it through /api/forecasts.
// On any API failure the store re-fetches the scenario so the UI never drifts
// from the database.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from '@/lib/toast'
import { SCENARIO_COOKIE, type Asset, type CellValue, type DebtSettings, type FlowDayValue, type ForecastData, type Rates, type ScenarioSummary, type Section } from '@/lib/forecasts/types'
import { computeForecast, type Computed } from '@/lib/forecasts/computed'
import { setFlowDay as setFlowDayPure, clearFlowDay as clearFlowDayPure } from '@/lib/forecasts/flowDays'
import { buildMonths, parseMonthLabel } from '@/lib/forecasts/months'

const API_SECTION: Record<Section, 'income' | 'expense' | 'debt'> = { income: 'income', expenses: 'expense', receivables: 'debt' }

interface ForecastStore {
  data: ForecastData
  scenarios: ScenarioSummary[]
  rates: Rates
  computed: Computed
  readOnly: boolean
  saving: boolean
  switchScenario: (id: string) => void
  refresh: () => Promise<void>
  updateCell: (section: Section, key: string, index: number, value: CellValue) => void
  updateCells: (section: Section, key: string, entries: { index: number; value: CellValue }[]) => void
  setViewRange: (from: number, to: number) => void
  addRevenueItem: (name: string, currency?: string) => Promise<boolean>
  addExpenseCategory: (name: string) => Promise<boolean>
  addExpenseItem: (name: string, categoryName: string | null) => Promise<boolean>
  addReceivable: (name: string) => Promise<boolean>
  removeRow: (section: Section, key: string) => void
  renameRow: (section: Section, oldKey: string, newKey: string) => void
  reorderRow: (section: Section, dragKey: string, targetKey: string, position: 'before' | 'after') => void
  toggleRowVisibility: (section: Section, key: string) => void
  setIncomeCurrency: (key: string, currency: string) => void
  updateDebtSettings: (name: string, settings: Partial<DebtSettings>) => void
  setBankBalance: (monthIndex: number, amount: number, day: number) => void
  clearBankBalance: (monthIndex: number) => void
  setFlowDay: (section: Section, row: string, monthIndex: number, day: FlowDayValue, scope: 'month' | 'onward') => void
  clearFlowDay: (section: Section, row: string, monthIndex: number) => void
  addAsset: (name: string, value: number, type: Asset['type'], linkedDebt: string | null) => Promise<boolean>
  updateAsset: (name: string, patch: Partial<Asset>) => void
  renameAsset: (oldName: string, newName: string) => void
  removeAsset: (name: string) => void
  renameScenario: (name: string) => void
  setRateOverride: (currency: 'USD' | 'EUR', rate: number | null) => void
  extendMonths: (count: number) => void
  /** Fill an income row with Books' invoiced revenue (CAD) for every month in the workbook. */
  importBooksRevenue: (rowName?: string) => Promise<boolean>
  isLinked: (section: Section, key: string) => boolean
  setBooksLinked: (on: boolean) => void
  setOwnerPayAccounts: (glAccountIds: string[]) => void
}

const Ctx = createContext<ForecastStore | null>(null)

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

async function api(path: string, method: string, body?: unknown): Promise<Response> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { const j = await res.json(); if (j?.error) msg = j.error } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res
}

interface Props {
  initialData: ForecastData
  scenarios: ScenarioSummary[]
  initialRates: Rates
  readOnly: boolean
  children: React.ReactNode
}

export function ForecastProvider({ initialData, scenarios, initialRates, readOnly, children }: Props) {
  const router = useRouter()
  const [data, setData] = useState<ForecastData>(initialData)
  const [saving, setSaving] = useState(false)
  const pending = useRef(0)
  const dataRef = useRef(data)
  dataRef.current = data

  // A new scenario arrived from the server (switch or refresh).
  useEffect(() => { setData(initialData) }, [initialData])

  const rates = useMemo<Rates>(() => {
    const r: Rates = { ...initialRates }
    for (const [ccy, v] of Object.entries(data.rateOverrides || {})) r[ccy] = v
    return r
  }, [initialRates, data.rateOverrides])

  const computed = useMemo(() => computeForecast(data, rates), [data, rates])

  const base = `/api/forecasts/${data.id}`

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base, { cache: 'no-store' })
      if (res.ok) setData(await res.json())
    } catch { /* keep current state */ }
  }, [base])

  /** Apply `local` immediately, then run `remote`. On failure toast + reload from server. */
  const mutate = useCallback(
    async (local: (prev: ForecastData) => ForecastData, remote: (next: ForecastData) => Promise<void>): Promise<boolean> => {
      if (readOnly) { toast.error('Read-only access: changes are disabled.'); return false }
      const next = local(dataRef.current)
      dataRef.current = next
      setData(next)
      pending.current++
      setSaving(true)
      try {
        await remote(next)
        return true
      } catch (e) {
        toast.error((e as Error).message || 'Save failed')
        await refresh()
        return false
      } finally {
        pending.current--
        if (pending.current === 0) setSaving(false)
      }
    },
    [readOnly, refresh]
  )

  const switchScenario = useCallback((id: string) => {
    document.cookie = `${SCENARIO_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }, [router])

  const rowId = (d: ForecastData, section: Section, key: string): string | undefined => d.ids.rows[section][key]
  const isLinked = useCallback((section: Section, key: string) => !!dataRef.current.linked[section]?.[key], [])
  const linkedGuard = (section: Section, key: string): boolean => {
    if (!dataRef.current.linked[section]?.[key]) return false
    toast.error('This row comes from Books. Change it on the Books side.')
    return true
  }

  // ── Cells ──────────────────────────────────────────────────────────────

  const updateCells = useCallback((section: Section, key: string, entries: { index: number; value: CellValue }[]) => {
    if (!entries.length) return
    const cur = dataRef.current
    if (cur.linked[section]?.[key]) {
      const locked = cur.linkedOverride[section]?.[key]
      if (entries.some((e) => locked?.[e.index] ?? true)) { toast.error('That month comes from Books. Only future months without Books activity can be forecast by hand.'); return }
    }
    void mutate(
      (prev) => {
        const next = clone(prev)
        const arr = (next[section] as Record<string, CellValue[] | null>)[key]
        if (!arr) return prev
        for (const e of entries) arr[e.index] = e.value
        return next
      },
      async (next) => {
        let id = rowId(next, section, key)
        if (!id && next.linked[section]?.[key] && (section === 'income' || section === 'expenses')) {
          // First manual forecast on a Books row: create its shadow row (same name) to hold future months.
          const res = await api(`${base}/rows`, 'POST', { section: API_SECTION[section], name: key, currency: 'CAD' })
          id = ((await res.json()) as { id: string }).id
          const nid = id
          setData((prev) => { const n2 = clone(prev); n2.ids.rows[section][key] = nid; return n2 })
          dataRef.current = { ...dataRef.current, ids: { ...dataRef.current.ids, rows: { ...dataRef.current.ids.rows, [section]: { ...dataRef.current.ids.rows[section], [key]: nid } } } }
        }
        if (!id) throw new Error('Row not saved yet; try again')
        await api(`${base}/cells`, 'PUT', { cells: entries.map((e) => ({ rowId: id, monthIndex: e.index, value: e.value })) })
      }
    )
  }, [base, mutate])

  const updateCell = useCallback((section: Section, key: string, index: number, value: CellValue) => {
    updateCells(section, key, [{ index, value }])
  }, [updateCells])

  // ── View range / months ────────────────────────────────────────────────

  const setViewRange = useCallback((from: number, to: number) => {
    void mutate(
      (prev) => {
        const next = clone(prev)
        if (to + 1 > next.months.length) {
          const first = parseMonthLabel(next.months[0])
          if (first) next.months = buildMonths(first.year, first.month, to + 1)
          const pad = (arr: CellValue[] | null) => { if (arr) while (arr.length < next.months.length) arr.push(0) }
          Object.values(next.income).forEach(pad)
          Object.values(next.expenses).forEach(pad)
          Object.values(next.receivables).forEach(pad)
        }
        next.viewFrom = from
        next.viewTo = to
        return next
      },
      async () => { await api(base, 'PATCH', { viewFrom: from, viewTo: to }) }
    )
  }, [base, mutate])

  // ── Rows ───────────────────────────────────────────────────────────────

  const addRow = useCallback(async (section: Section, name: string, extra: { currency?: string; categoryName?: string | null }): Promise<boolean> => {
    const n = name.trim()
    if (!n) return false
    const current = dataRef.current
    if ((current[section] as Record<string, unknown>)[n] !== undefined) { toast.error(`"${n}" already exists`); return false }
    const categoryId = extra.categoryName ? current.ids.categories[extra.categoryName] : null
    let created: { id: string } | null = null
    const ok = await mutate(
      (prev) => {
        const next = clone(prev)
        const zeros: CellValue[] = new Array(next.months.length).fill(0)
        if (section === 'expenses') {
          // Insert right after the last row of the target category (or at the front when uncategorized).
          const entries = Object.entries(next.expenses)
          const out: [string, CellValue[] | null][] = []
          let inserted = false
          if (!extra.categoryName) { out.push([n, zeros]); inserted = true }
          let inCat = false
          for (const [k, v] of entries) {
            if (k.startsWith('_')) {
              if (inCat && !inserted) { out.push([n, zeros]); inserted = true }
              inCat = k === `_${extra.categoryName}`
            }
            out.push([k, v])
          }
          if (!inserted) out.push([n, zeros])
          next.expenses = Object.fromEntries(out)
        } else {
          ;(next[section] as Record<string, CellValue[]>)[n] = zeros
          if (section === 'income' && extra.currency && extra.currency !== 'CAD') next.incomeCurrencies[n] = extra.currency
          if (section === 'receivables') next.debtSettings[n] = { type: 'simple', interestRate: 0, amortizationMonths: null, remainingMonths: null, linkedExpense: null, linkedAsset: null }
        }
        return next
      },
      async () => {
        const res = await api(`${base}/rows`, 'POST', { section: API_SECTION[section], name: n, currency: extra.currency, categoryId })
        created = await res.json()
      }
    )
    if (ok && created) {
      const id = (created as { id: string }).id
      setData((prev) => { const next = clone(prev); next.ids.rows[section][n] = id; return next })
      dataRef.current = { ...dataRef.current, ids: { ...dataRef.current.ids, rows: { ...dataRef.current.ids.rows, [section]: { ...dataRef.current.ids.rows[section], [n]: id } } } }
    }
    return ok
  }, [base, mutate])

  const addRevenueItem = useCallback((name: string, currency?: string) => addRow('income', name, { currency }), [addRow])
  const addReceivable = useCallback((name: string) => addRow('receivables', name, {}), [addRow])
  const addExpenseItem = useCallback((name: string, categoryName: string | null) => addRow('expenses', name, { categoryName }), [addRow])

  const addExpenseCategory = useCallback(async (name: string): Promise<boolean> => {
    const n = name.trim()
    if (!n) return false
    if (dataRef.current.expenses[`_${n}`] !== undefined) { toast.error(`Category "${n}" already exists`); return false }
    let created: { id: string } | null = null
    const ok = await mutate(
      (prev) => { const next = clone(prev); next.expenses[`_${n}`] = null; return next },
      async () => { created = await (await api(`${base}/categories`, 'POST', { name: n })).json() }
    )
    if (ok && created) {
      const id = (created as { id: string }).id
      setData((prev) => { const next = clone(prev); next.ids.categories[n] = id; return next })
      dataRef.current = { ...dataRef.current, ids: { ...dataRef.current.ids, categories: { ...dataRef.current.ids.categories, [n]: id } } }
    }
    return ok
  }, [base, mutate])

  const removeRow = useCallback((section: Section, key: string) => {
    if (linkedGuard(section, key)) return
    const isCategory = section === 'expenses' && key.startsWith('_')
    const current = dataRef.current
    const id = isCategory ? current.ids.categories[key.slice(1)] : rowId(current, section, key)
    void mutate(
      (prev) => {
        const next = clone(prev)
        if (isCategory) {
          // Drop the header and every row until the next header.
          const entries = Object.entries(next.expenses)
          const out: [string, CellValue[] | null][] = []
          let skipping = false
          for (const [k, v] of entries) {
            if (k.startsWith('_')) skipping = k === key
            if (skipping) { if (!k.startsWith('_')) delete next.ids.rows.expenses[k]; continue }
            out.push([k, v])
          }
          next.expenses = Object.fromEntries(out)
          delete next.ids.categories[key.slice(1)]
        } else {
          delete (next[section] as Record<string, unknown>)[key]
          delete next.ids.rows[section][key]
          if (section === 'income') delete next.incomeCurrencies[key]
          if (section === 'receivables') {
            delete next.debtSettings[key]
            Object.values(next.assets).forEach((a) => { if (a.linkedDebt === key) a.linkedDebt = null })
          }
          if (section === 'expenses') Object.values(next.debtSettings).forEach((s) => { if (s.linkedExpense === key) s.linkedExpense = null })
          if (next._hidden[section]) delete next._hidden[section]![key]
          if (next.flowDays[section]) delete next.flowDays[section]![key]
        }
        return next
      },
      async () => {
        if (!id) return
        await api(isCategory ? `${base}/categories/${id}` : `${base}/rows/${id}`, 'DELETE')
      }
    )
  }, [base, mutate])

  const renameRow = useCallback((section: Section, oldKey: string, newKey: string) => {
    if (linkedGuard(section, oldKey)) return
    const isCategory = section === 'expenses' && oldKey.startsWith('_')
    const current = dataRef.current
    if ((current[section] as Record<string, unknown>)[newKey] !== undefined) { toast.error('That name is already in use'); return }
    const id = isCategory ? current.ids.categories[oldKey.slice(1)] : rowId(current, section, oldKey)
    void mutate(
      (prev) => {
        const next = clone(prev)
        const rebuilt: Record<string, CellValue[] | null> = {}
        for (const [k, v] of Object.entries(next[section] as Record<string, CellValue[] | null>)) rebuilt[k === oldKey ? newKey : k] = v
        ;(next as unknown as Record<Section, Record<string, CellValue[] | null>>)[section] = rebuilt
        if (isCategory) {
          next.ids.categories[newKey.slice(1)] = next.ids.categories[oldKey.slice(1)]
          delete next.ids.categories[oldKey.slice(1)]
        } else {
          next.ids.rows[section][newKey] = next.ids.rows[section][oldKey]
          delete next.ids.rows[section][oldKey]
          if (section === 'income' && next.incomeCurrencies[oldKey]) { next.incomeCurrencies[newKey] = next.incomeCurrencies[oldKey]; delete next.incomeCurrencies[oldKey] }
          if (section === 'receivables') {
            Object.values(next.assets).forEach((a) => { if (a.linkedDebt === oldKey) a.linkedDebt = newKey })
            if (next.debtSettings[oldKey]) { next.debtSettings[newKey] = next.debtSettings[oldKey]; delete next.debtSettings[oldKey] }
          }
          if (section === 'expenses') Object.values(next.debtSettings).forEach((s) => { if (s.linkedExpense === oldKey) s.linkedExpense = newKey })
          const h = next._hidden[section]; if (h && h[oldKey] !== undefined) { h[newKey] = h[oldKey]; delete h[oldKey] }
          const f = next.flowDays[section]; if (f && f[oldKey]) { f[newKey] = f[oldKey]; delete f[oldKey] }
        }
        return next
      },
      async () => {
        if (!id) return
        await api(isCategory ? `${base}/categories/${id}` : `${base}/rows/${id}`, 'PATCH', { name: isCategory ? newKey.slice(1) : newKey })
      }
    )
  }, [base, mutate])

  const reorderRow = useCallback((section: Section, dragKey: string, targetKey: string, position: 'before' | 'after') => {
    if (dragKey === targetKey || linkedGuard(section, dragKey) || linkedGuard(section, targetKey)) return
    void mutate(
      (prev) => {
        const next = clone(prev)
        const entries = Object.entries(next[section] as Record<string, CellValue[] | null>)
        const dragIdx = entries.findIndex(([k]) => k === dragKey)
        if (dragIdx === -1) return prev
        let block: [string, CellValue[] | null][]
        if (section === 'expenses' && dragKey.startsWith('_')) {
          let end = dragIdx + 1
          while (end < entries.length && !entries[end][0].startsWith('_')) end++
          block = entries.splice(dragIdx, end - dragIdx)
        } else {
          block = entries.splice(dragIdx, 1)
        }
        let targetIdx = entries.findIndex(([k]) => k === targetKey)
        if (targetIdx === -1) entries.push(...block)
        else {
          if (position === 'after') {
            if (section === 'expenses' && targetKey.startsWith('_') && dragKey.startsWith('_')) {
              let end = targetIdx + 1
              while (end < entries.length && !entries[end][0].startsWith('_')) end++
              targetIdx = end
            } else targetIdx++
          }
          entries.splice(targetIdx, 0, ...block)
        }
        ;(next as unknown as Record<Section, Record<string, CellValue[] | null>>)[section] = Object.fromEntries(entries)
        return next
      },
      async (next) => {
        const keys = Object.keys(next[section] as Record<string, unknown>)
        const categories: { id: string; sortOrder: number }[] = []
        const rows: { id: string; sortOrder: number; categoryId?: string | null }[] = []
        let currentCat: string | null = null
        let catOrder = 0
        keys.forEach((k, i) => {
          if (section === 'expenses' && k.startsWith('_')) {
            const cid = next.ids.categories[k.slice(1)]
            if (cid) categories.push({ id: cid, sortOrder: catOrder++ })
            currentCat = cid ?? null
            return
          }
          const id = next.ids.rows[section][k]
          if (!id) return
          rows.push(section === 'expenses' ? { id, sortOrder: i, categoryId: currentCat } : { id, sortOrder: i })
        })
        await api(`${base}/rows/reorder`, 'PUT', { section: API_SECTION[section], categories: section === 'expenses' ? categories : undefined, rows })
      }
    )
  }, [base, mutate])

  const toggleRowVisibility = useCallback((section: Section, key: string) => {
    const id = rowId(dataRef.current, section, key)
    const hidden = !dataRef.current._hidden[section]?.[key]
    void mutate(
      (prev) => { const next = clone(prev); (next._hidden[section] ||= {})[key] = hidden; return next },
      async () => { if (id) await api(`${base}/rows/${id}`, 'PATCH', { hidden }) }
    )
  }, [base, mutate])

  const setIncomeCurrency = useCallback((key: string, currency: string) => {
    const id = rowId(dataRef.current, 'income', key)
    void mutate(
      (prev) => { const next = clone(prev); if (currency === 'CAD') delete next.incomeCurrencies[key]; else next.incomeCurrencies[key] = currency; return next },
      async () => { if (id) await api(`${base}/rows/${id}`, 'PATCH', { currency }) }
    )
  }, [base, mutate])

  const updateDebtSettings = useCallback((name: string, settings: Partial<DebtSettings>) => {
    const current = dataRef.current
    const id = rowId(current, 'receivables', name)
    void mutate(
      (prev) => {
        const next = clone(prev)
        next.debtSettings[name] = { ...(next.debtSettings[name] || { type: 'simple', interestRate: 0, amortizationMonths: null, remainingMonths: null, linkedExpense: null, linkedAsset: null }), ...settings }
        return next
      },
      async (next) => {
        if (!id) return
        const s = next.debtSettings[name]
        await api(`${base}/rows/${id}`, 'PATCH', {
          debtType: s.type,
          interestRate: s.interestRate,
          amortizationMonths: s.amortizationMonths,
          remainingMonths: s.remainingMonths,
          linkedExpenseId: s.linkedExpense ? next.ids.rows.expenses[s.linkedExpense] ?? null : null,
          linkedAssetId: s.linkedAsset ? next.ids.assets[s.linkedAsset] ?? null : null,
        })
      }
    )
  }, [base, mutate])

  // ── Bank balances / flow days ──────────────────────────────────────────

  const setBankBalance = useCallback((monthIndex: number, amount: number, day: number) => {
    void mutate(
      (prev) => { const next = clone(prev); next.bankBalances[String(monthIndex)] = { amount, day: day || 1 }; return next },
      async () => { await api(`${base}/bank-balances`, 'PUT', { monthIndex, amount, day: day || 1 }) }
    )
  }, [base, mutate])

  const clearBankBalance = useCallback((monthIndex: number) => {
    void mutate(
      (prev) => { const next = clone(prev); delete next.bankBalances[String(monthIndex)]; return next },
      async () => { await api(`${base}/bank-balances?monthIndex=${monthIndex}`, 'DELETE') }
    )
  }, [base, mutate])

  const setFlowDay = useCallback((section: Section, row: string, monthIndex: number, day: FlowDayValue, scope: 'month' | 'onward') => {
    if (linkedGuard(section, row)) return
    const id = rowId(dataRef.current, section, row)
    void mutate(
      (prev) => ({ ...prev, flowDays: setFlowDayPure(prev.flowDays, section, row, monthIndex, day, scope) }),
      async () => { if (id) await api(`${base}/flow-days`, 'PUT', { rowId: id, monthIndex, day, scope }) }
    )
  }, [base, mutate])

  const clearFlowDay = useCallback((section: Section, row: string, monthIndex: number) => {
    const id = rowId(dataRef.current, section, row)
    void mutate(
      (prev) => ({ ...prev, flowDays: clearFlowDayPure(prev.flowDays, section, row, monthIndex) }),
      async () => { if (id) await api(`${base}/flow-days?rowId=${encodeURIComponent(id)}&monthIndex=${monthIndex}`, 'DELETE') }
    )
  }, [base, mutate])

  // ── Assets ─────────────────────────────────────────────────────────────

  const addAsset = useCallback(async (name: string, value: number, type: Asset['type'], linkedDebt: string | null): Promise<boolean> => {
    const n = name.trim()
    if (!n) return false
    if (dataRef.current.assets[n] !== undefined) { toast.error(`"${n}" already exists`); return false }
    let created: { id: string } | null = null
    const ok = await mutate(
      (prev) => { const next = clone(prev); next.assets[n] = { value: value || 0, type: type || 'other', linkedDebt: linkedDebt || null }; return next },
      async (next) => {
        created = await (await api(`${base}/assets`, 'POST', { name: n, value: value || 0, type: type || 'other', linkedDebtId: linkedDebt ? next.ids.rows.receivables[linkedDebt] ?? null : null })).json()
      }
    )
    if (ok && created) {
      const id = (created as { id: string }).id
      setData((prev) => { const next = clone(prev); next.ids.assets[n] = id; return next })
      dataRef.current = { ...dataRef.current, ids: { ...dataRef.current.ids, assets: { ...dataRef.current.ids.assets, [n]: id } } }
    }
    return ok
  }, [base, mutate])

  const updateAsset = useCallback((name: string, patch: Partial<Asset>) => {
    const id = dataRef.current.ids.assets[name]
    void mutate(
      (prev) => { const next = clone(prev); if (next.assets[name]) next.assets[name] = { ...next.assets[name], ...patch }; return next },
      async (next) => {
        if (!id) return
        const a = next.assets[name]
        await api(`${base}/assets/${id}`, 'PATCH', { value: a.value, type: a.type, linkedDebtId: a.linkedDebt ? next.ids.rows.receivables[a.linkedDebt] ?? null : null })
      }
    )
  }, [base, mutate])

  const renameAsset = useCallback((oldName: string, newName: string) => {
    const id = dataRef.current.ids.assets[oldName]
    if (dataRef.current.assets[newName] !== undefined) { toast.error('That name is already in use'); return }
    void mutate(
      (prev) => {
        const next = clone(prev)
        const rebuilt: Record<string, Asset> = {}
        for (const [k, v] of Object.entries(next.assets)) rebuilt[k === oldName ? newName : k] = v
        next.assets = rebuilt
        next.ids.assets[newName] = next.ids.assets[oldName]; delete next.ids.assets[oldName]
        Object.values(next.debtSettings).forEach((s) => { if (s.linkedAsset === oldName) s.linkedAsset = newName })
        return next
      },
      async () => { if (id) await api(`${base}/assets/${id}`, 'PATCH', { name: newName }) }
    )
  }, [base, mutate])

  const removeAsset = useCallback((name: string) => {
    const id = dataRef.current.ids.assets[name]
    void mutate(
      (prev) => {
        const next = clone(prev)
        delete next.assets[name]; delete next.ids.assets[name]
        Object.values(next.debtSettings).forEach((s) => { if (s.linkedAsset === name) s.linkedAsset = null })
        return next
      },
      async () => { if (id) await api(`${base}/assets/${id}`, 'DELETE') }
    )
  }, [base, mutate])

  const setBooksLinked = useCallback((on: boolean) => {
    void mutate(
      (prev) => ({ ...prev, booksLinked: on }),
      async () => { await api(base, 'PATCH', { booksLinked: on }) }
    ).then((ok) => { if (ok) router.refresh() })
  }, [base, mutate, router])

  const setOwnerPayAccounts = useCallback((glAccountIds: string[]) => {
    void mutate(
      (prev) => ({ ...prev, ownerPayGlAccountIds: glAccountIds }),
      async () => { await api(base, 'PATCH', { ownerPayGlAccountIds: glAccountIds }) }
    ).then((ok) => { if (ok) router.refresh() })
  }, [base, mutate, router])

  const renameScenario = useCallback((name: string) => {
    void mutate(
      (prev) => ({ ...prev, name }),
      async () => { await api(base, 'PATCH', { name }) }
    ).then((ok) => { if (ok) router.refresh() })
  }, [base, mutate, router])

  const setRateOverride = useCallback((currency: 'USD' | 'EUR', rate: number | null) => {
    void mutate(
      (prev) => { const next = clone(prev); if (rate === null) delete next.rateOverrides[currency]; else next.rateOverrides[currency] = rate; return next },
      async () => { await api(`${base}/rate-overrides`, 'PUT', { currency, rate }) }
    )
  }, [base, mutate])

  const extendMonths = useCallback((count: number) => {
    const current = dataRef.current
    if (count <= current.months.length) return
    setViewRange(current.viewFrom, Math.max(current.viewTo, count - 1))
  }, [setViewRange])

  const importBooksRevenue = useCallback(async (rowName = 'Invoiced revenue (Books)'): Promise<boolean> => {
    const current = dataRef.current
    const first = parseMonthLabel(current.months[0])
    const last = parseMonthLabel(current.months[current.months.length - 1])
    if (!first || !last) return false
    const ym = (p: { year: number; month: number }) => `${p.year}-${String(p.month + 1).padStart(2, '0')}`
    let months: Record<string, number>
    try {
      const res = await api(`/api/forecasts/books/revenue?from=${ym(first)}&to=${ym(last)}`, 'GET')
      months = (await res.json()).data.months
    } catch (e) { toast.error((e as Error).message); return false }
    if (current.income[rowName] === undefined) {
      const ok = await addRow('income', rowName, { currency: 'CAD' })
      if (!ok) return false
    }
    const entries = dataRef.current.months.map((label, index) => {
      const p = parseMonthLabel(label)
      return { index, value: p ? months[ym(p)] ?? 0 : 0 }
    })
    updateCells('income', rowName, entries)
    return true
  }, [addRow, updateCells])

  const value = useMemo<ForecastStore>(() => ({
    data, scenarios, rates, computed, readOnly, saving,
    switchScenario, refresh,
    updateCell, updateCells, setViewRange,
    addRevenueItem, addExpenseCategory, addExpenseItem, addReceivable,
    removeRow, renameRow, reorderRow, toggleRowVisibility, setIncomeCurrency, updateDebtSettings,
    setBankBalance, clearBankBalance, setFlowDay, clearFlowDay,
    addAsset, updateAsset, renameAsset, removeAsset,
    renameScenario, setRateOverride, extendMonths, importBooksRevenue,
    isLinked, setBooksLinked, setOwnerPayAccounts,
  }), [isLinked, setBooksLinked, setOwnerPayAccounts, data, scenarios, rates, computed, readOnly, saving, switchScenario, refresh, updateCell, updateCells, setViewRange, addRevenueItem, addExpenseCategory, addExpenseItem, addReceivable, removeRow, renameRow, reorderRow, toggleRowVisibility, setIncomeCurrency, updateDebtSettings, setBankBalance, clearBankBalance, setFlowDay, clearFlowDay, addAsset, updateAsset, renameAsset, removeAsset, renameScenario, setRateOverride, extendMonths, importBooksRevenue])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useForecast(): ForecastStore {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useForecast must be used within ForecastProvider')
  return ctx
}
