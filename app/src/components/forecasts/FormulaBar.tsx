'use client'

// Floating formula bar + shared autocomplete. Mirrors WealthPilot: clicking a
// cell opens it, the pick button lets the user click other cells (on any
// section page) to insert references, Done writes the cell.

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import type { Section } from '@/lib/forecasts/types'
import { buildCellRef, buildSuggestions, getCurrentToken, getMonthPartial, isFormula, parseTypedNumber, replaceCurrentToken, type RefSuggestion } from '@/lib/forecasts/formula'
import { useForecast } from './ForecastProvider'
import { toast } from '@/lib/toast'

export interface SelectMode {
  section: Section
  key: string
  index: number
  formula: string
  originPath: string
  picking: boolean
  /** The cell being edited belongs to this scenario, even after switching away. */
  originScenarioId: string
  originScenarioName: string
  /** Row id in the origin scenario; needed to save from a different scenario. */
  originRowId: string | null
  /** Month label of the cell being edited, for the header chip. */
  originMonth: string | null
}

export interface SelectOrigin {
  scenarioId: string
  scenarioName: string
  rowId: string | null
  month: string | null
}

interface FormulaBarCtx {
  selectMode: SelectMode | null
  startSelect: (section: Section, key: string, index: number, formula: string, originPath: string, origin: SelectOrigin) => void
  cancelSelect: () => void
  insertRef: (section: Section, key: string, monthLabel: string | null, scenario?: string | null) => void
  updateFormula: (formula: string) => void
  setPicking: (picking: boolean) => void
  preventBlurRef: React.RefObject<boolean>
  /** Briefly suppress cell blur-commit (while the user clicks inside the bar). */
  holdBlur: () => void
}

const FormulaContext = createContext<FormulaBarCtx | null>(null)

export function FormulaBarProvider({ children }: { children: React.ReactNode }) {
  const [selectMode, setSelectMode] = useState<SelectMode | null>(null)
  const preventBlurRef = useRef(false)

  const startSelect = useCallback((section: Section, key: string, index: number, formula: string, originPath: string, origin: SelectOrigin) => {
    setSelectMode({
      section, key, index, formula, originPath, picking: false,
      originScenarioId: origin.scenarioId,
      originScenarioName: origin.scenarioName,
      originRowId: origin.rowId,
      originMonth: origin.month,
    })
  }, [])
  const cancelSelect = useCallback(() => setSelectMode(null), [])
  const setPicking = useCallback((picking: boolean) => setSelectMode((p) => (p ? { ...p, picking } : null)), [])
  const insertRef = useCallback((section: Section, key: string, monthLabel: string | null, scenario: string | null = null) => {
    setSelectMode((p) => {
      if (!p) return null
      const ref = buildCellRef(section, key, monthLabel, scenario)
      // A bare number in the bar is the cell's old value, not something to
      // build on — the first pick replaces it and starts the formula.
      const base = isFormula(p.formula) ? p.formula : '='
      return { ...p, formula: base + ref }
    })
  }, [])
  const updateFormula = useCallback((formula: string) => setSelectMode((p) => (p ? { ...p, formula } : null)), [])
  const holdBlur = useCallback(() => {
    preventBlurRef.current = true
    setTimeout(() => { preventBlurRef.current = false }, 300)
  }, [])

  const value = useMemo(() => ({ selectMode, startSelect, cancelSelect, insertRef, updateFormula, setPicking, preventBlurRef, holdBlur }), [selectMode, startSelect, cancelSelect, insertRef, updateFormula, setPicking, holdBlur])
  return <FormulaContext.Provider value={value}>{children}</FormulaContext.Provider>
}

export function useFormulaBar(): FormulaBarCtx | null {
  return useContext(FormulaContext)
}

// ─── Autocomplete dropdown (shared with EditableTable) ───────────────────

export function FormulaAutocomplete({ editVal, suggestions, onSelect, selectedIdx, months, onMonthSelect }: {
  editVal: string
  suggestions: RefSuggestion[]
  onSelect: (s: RefSuggestion) => void
  selectedIdx: number
  months: string[]
  onMonthSelect: (ref: string, month: string) => void
}) {
  const token = getCurrentToken(editVal)
  if (!token) return null
  const monthInfo = getMonthPartial(token)
  const itemCls = (active: boolean) =>
    `flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-[12px] ${active ? 'bg-[#DEEBFF] text-[#0747A6]' : 'text-gray-700 hover:bg-gray-50'}`
  const wrap = 'absolute left-0 top-full z-50 mt-1 w-64 max-h-60 overflow-auto rounded-md border border-gray-200 bg-white shadow-lg'

  if (monthInfo) {
    const partial = monthInfo.partial.toLowerCase()
    const filtered = (partial ? months.filter((m) => m.toLowerCase().includes(partial)) : months).slice(0, 8)
    if (!filtered.length) return null
    return (
      <div className={wrap}>
        {filtered.map((m, i) => (
          <button key={m} type="button" className={itemCls(i === selectedIdx)} onMouseDown={(e) => { e.preventDefault(); onMonthSelect(monthInfo.ref, m) }}>
            <span className="text-[10px] uppercase tracking-wide text-gray-400 w-16">month</span>
            <span className="font-medium">{m}</span>
          </button>
        ))}
      </div>
    )
  }

  const lower = token.toLowerCase()
  const filtered = suggestions.filter((s) => s.ref.toLowerCase().includes(lower) || s.key.toLowerCase().includes(lower)).slice(0, 8)
  if (!filtered.length) return null
  return (
    <div className={wrap}>
      {filtered.map((s, i) => (
        <button key={s.ref} type="button" className={itemCls(i === selectedIdx)} onMouseDown={(e) => { e.preventDefault(); onSelect(s) }}>
          <span className="text-[10px] uppercase tracking-wide text-gray-400 w-16">{s.section}</span>
          <span className="font-medium truncate">{s.key}</span>
        </button>
      ))}
    </div>
  )
}

/** Filtered row suggestions / month suggestions for the current token. */
export function useSuggestionLists(val: string, suggestions: RefSuggestion[], months: string[]) {
  const token = getCurrentToken(val)
  const monthInfo = isFormula(val) ? getMonthPartial(token) : null
  const monthSugs = monthInfo
    ? (monthInfo.partial ? months.filter((m) => m.toLowerCase().includes(monthInfo.partial.toLowerCase())) : months).slice(0, 8)
    : []
  const rowSugs = isFormula(val) && token && !monthInfo
    ? suggestions.filter((s) => s.ref.toLowerCase().includes(token.toLowerCase()) || s.key.toLowerCase().includes(token.toLowerCase())).slice(0, 8)
    : []
  return { token, monthInfo, monthSugs, rowSugs }
}

// ─── The bar itself ──────────────────────────────────────────────────────

const SECTION_ROUTES: Record<Section, string> = { income: '/forecasts/income', expenses: '/forecasts/expenses', receivables: '/forecasts/debts' }

export default function FormulaBar() {
  const bar = useFormulaBar()
  const { data, scenarios, updateCell, updateCellIn, switchScenario } = useForecast()
  const router = useRouter()
  const pathname = usePathname()
  const inputRef = useRef<HTMLInputElement>(null)
  const [acIdx, setAcIdx] = useState(0)
  const selectMode = bar?.selectMode ?? null
  const suggestions = useMemo(() => (selectMode ? buildSuggestions(data) : []), [selectMode, data])
  const formula = selectMode?.formula ?? ''
  const { monthInfo, monthSugs, rowSugs, token } = useSuggestionLists(formula, suggestions, data.months)

  if (!bar || !selectMode) return null

  // The cell being edited may live in a scenario the user has since switched
  // away from; Done must write there, not into whatever is on screen.
  const away = selectMode.originScenarioId !== data.id
  const goBack = () => {
    if (away) switchScenario(selectMode.originScenarioId)
    if (selectMode.originPath && pathname !== selectMode.originPath) router.push(selectMode.originPath)
  }
  const handleDone = async () => {
    const trimmed = selectMode.formula.trim()
    const value = trimmed.startsWith('=') ? trimmed : parseTypedNumber(trimmed)
    if (away) {
      if (!selectMode.originRowId) { toast.error('That row has no id yet — reopen the cell and try again.'); return }
      const saved = await updateCellIn(selectMode.originScenarioId, selectMode.originRowId, selectMode.index, value)
      if (!saved) return
    } else {
      updateCell(selectMode.section, selectMode.key, selectMode.index, value)
    }
    goBack(); bar.cancelSelect()
  }
  const handleCancel = () => { goBack(); bar.cancelSelect() }
  const replaceToken = (t: string) => { bar.updateFormula(replaceCurrentToken(formula, t)); setAcIdx(0); inputRef.current?.focus() }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (monthSugs.length && isFormula(formula)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx((p) => Math.min(p + 1, monthSugs.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx((p) => Math.max(p - 1, 0)); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); if (monthInfo) replaceToken(`${monthInfo.ref}.${monthSugs[acIdx]}`); return }
    }
    if (rowSugs.length && isFormula(formula)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx((p) => Math.min(p + 1, rowSugs.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx((p) => Math.max(p - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && token.length > 0)) {
        const exact = rowSugs.find((s) => s.ref === token)
        if (e.key === 'Tab' || !exact) { e.preventDefault(); replaceToken(rowSugs[acIdx].ref); return }
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); void handleDone() }
    if (e.key === 'Escape') handleCancel()
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-50 flex w-[min(880px,calc(100%-2rem))] -translate-x-1/2 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-xl lg:left-[calc(50%+110px)]"
      onMouseDown={bar.holdBlur}
    >
      <div
        className={`max-w-[200px] truncate rounded px-2 py-1 font-mono text-[12px] ${away ? 'bg-[#FFF0B3] text-[#7A5B00]' : 'bg-gray-100 text-gray-700'}`}
        title={`Editing ${selectMode.section} › ${selectMode.key} · ${selectMode.originMonth ?? ''} in ${selectMode.originScenarioName}`}
      >
        {away && <span className="mr-1 opacity-70">{selectMode.originScenarioName} ›</span>}
        {selectMode.key}
      </div>
      <div className="relative flex-1">
        <input
          ref={inputRef}
          className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-[13px] text-gray-900 focus:border-[#0075DD] focus:outline-none"
          value={formula}
          onChange={(e) => { bar.updateFormula(e.target.value); setAcIdx(0) }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          placeholder="Number or =income.Salary * 0.9"
        />
        {isFormula(formula) && (
          <FormulaAutocomplete editVal={formula} suggestions={suggestions} onSelect={(s) => replaceToken(s.ref)} selectedIdx={acIdx} months={data.months} onMonthSelect={(ref, m) => replaceToken(`${ref}.${m}`)} />
        )}
      </div>
      <button
        type="button"
        onClick={() => bar.setPicking(!selectMode.picking)}
        title="Click cells to insert references"
        className={`rounded border px-2 py-1 text-[12px] ${selectMode.picking ? 'border-[#0075DD] bg-[#DEEBFF] text-[#0747A6]' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
      >
        {selectMode.picking ? 'Picking' : 'Pick'}
      </button>
      {selectMode.picking && (
        <div className="flex gap-1">
          {(Object.keys(SECTION_ROUTES) as Section[]).map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => router.push(SECTION_ROUTES[sec])}
              className={`rounded px-2 py-1 text-[11px] capitalize ${pathname === SECTION_ROUTES[sec] ? 'bg-[#002D79] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {sec === 'receivables' ? 'debts' : sec}
            </button>
          ))}
          {scenarios.length > 1 && <span className="mx-1 w-px self-stretch bg-gray-200" />}
          {scenarios.length > 1 && scenarios.map((sc) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => switchScenario(sc.id)}
              title={`Pick cells from ${sc.name}`}
              className={`max-w-[110px] truncate rounded px-2 py-1 text-[11px] ${sc.id === data.id ? 'bg-[#002D79] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {sc.name}
            </button>
          ))}
        </div>
      )}
      <button type="button" onClick={() => void handleDone()} className="rounded bg-[#038A06] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#026e05]">
        {selectMode.picking || away ? 'Submit' : 'Done'}
      </button>
      <button type="button" onClick={handleCancel} className="rounded px-2 py-1 text-[12px] text-gray-500 hover:bg-gray-100" aria-label="Cancel">✕</button>
    </div>
  )
}
