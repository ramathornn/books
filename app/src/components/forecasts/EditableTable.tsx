'use client'

// The spreadsheet grid: inline editing with formula autocomplete, fill-down
// (drag the corner handle) with month-shifting formulas, cell-pick mode driven
// by the formula bar, drag-and-drop row reorder, and right-click day assignment.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import type { CellValue, FlowDayValue, Section } from '@/lib/forecasts/types'
import { buildSuggestions, getFormulaDisplay, isFormula, replaceCurrentToken, resolveValue, shiftFormulaMonths, type RefSuggestion } from '@/lib/forecasts/formula'
import { assignedDay, dayLabel, hasAssignedDay } from '@/lib/forecasts/flowDays'
import { fmtMoney } from '@/lib/forecasts/computed'
import { useForecast } from './ForecastProvider'
import { FormulaAutocomplete, useFormulaBar, useSuggestionLists } from './FormulaBar'
import SetDayModal from './SetDayModal'

export interface TableRow { key: string; label: string; isHeader?: boolean; currency?: string }

interface CellProps {
  raw: CellValue
  resolved: number
  section: Section
  dataKey: string
  index: number
  suggestions: RefSuggestion[]
  months: string[]
  readOnly: boolean
  filling: boolean
  dayBadge: string | null
  globalSelectMode: boolean
  onFillStart?: (key: string, index: number) => void
  onGlobalCellClick: (section: Section, key: string, monthLabel: string | null) => void
  onContextMenu?: (e: React.MouseEvent, section: Section, key: string, index: number) => void
}

function EditableCell({ raw, resolved, section, dataKey, index, suggestions, months, readOnly, filling, dayBadge, globalSelectMode, onFillStart, onGlobalCellClick, onContextMenu }: CellProps) {
  const { updateCell } = useForecast()
  const bar = useFormulaBar()
  const pathname = usePathname()
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const [acIdx, setAcIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const skipBlur = useRef(false)

  const sm = bar?.selectMode
  const isThisCell = !!sm && sm.section === section && sm.key === dataKey && sm.index === index
  const barFormula = isThisCell ? sm!.formula : undefined
  const { monthInfo, monthSugs, rowSugs, token } = useSuggestionLists(editVal, suggestions, months)

  useEffect(() => {
    if (editing && isThisCell && barFormula !== undefined && barFormula !== editVal) setEditVal(barFormula)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barFormula])

  const startEdit = () => {
    if (sm?.picking) { onGlobalCellClick(section, dataKey, months[index] ?? null); return }
    if (readOnly) return
    const resuming = isThisCell && !!sm
    const val = resuming ? sm!.formula : isFormula(raw) ? raw : String(raw || 0)
    setEditVal(val); setEditing(true); setAcIdx(0)
    if (bar && !resuming) bar.startSelect(section, dataKey, index, val, pathname)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const finishEdit = () => {
    if (skipBlur.current) { skipBlur.current = false; return }
    if (bar?.preventBlurRef.current) { setEditing(false); return }
    const trimmed = editVal.trim()
    const next: CellValue = isFormula(trimmed) ? trimmed : parseFloat(trimmed) || 0
    if (next !== raw) updateCell(section, dataKey, index, next)
    setEditing(false)
    if (isThisCell) bar?.cancelSelect()
  }
  const cancelEdit = () => { setEditing(false); bar?.cancelSelect() }
  const setVal = (v: string) => { setEditVal(v); setAcIdx(0); if (sm) bar?.updateFormula(v) }
  const replaceTok = (t: string) => { setVal(replaceCurrentToken(editVal, t)); inputRef.current?.focus() }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (monthSugs.length && isFormula(editVal)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx((p) => Math.min(p + 1, monthSugs.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx((p) => Math.max(p - 1, 0)); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); if (monthInfo) replaceTok(`${monthInfo.ref}.${monthSugs[acIdx]}`); return }
    }
    if (rowSugs.length && isFormula(editVal)) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIdx((p) => Math.min(p + 1, rowSugs.length - 1)); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAcIdx((p) => Math.max(p - 1, 0)); return }
      if (e.key === 'Tab' || (e.key === 'Enter' && token.length > 0)) {
        const exact = rowSugs.find((s) => s.ref === token)
        if (e.key === 'Tab' || !exact) { e.preventDefault(); replaceTok(rowSugs[acIdx].ref); return }
      }
    }
    if (e.key === 'Enter') { e.preventDefault(); finishEdit() }
    if (e.key === 'Escape') cancelEdit()
    if (e.key === 'Tab' && !isFormula(editVal)) {
      e.preventDefault(); finishEdit()
      const td = inputRef.current?.closest('td')
      const next = e.shiftKey ? td?.previousElementSibling : td?.nextElementSibling
      const el = next?.querySelector<HTMLElement>('[data-cell]')
      if (el) setTimeout(() => el.click(), 30)
    }
  }

  const hasFormula = isFormula(raw)
  return (
    <td
      className={`relative border-b border-gray-100 p-0 ${filling ? 'bg-[#DEEBFF]' : ''} ${globalSelectMode && !editing ? 'outline-dashed outline-1 outline-[#0075DD]/60 -outline-offset-1' : ''}`}
      data-key={dataKey}
      data-month-idx={index}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, section, dataKey, index) : undefined}
    >
      <div
        data-cell
        onClick={!editing ? startEdit : undefined}
        title={readOnly ? 'Auto-calculated' : hasFormula && !editing ? getFormulaDisplay(raw) ?? undefined : undefined}
        className={`group flex h-8 items-center justify-end gap-1 px-3 text-[13px] tabular-nums ${readOnly ? 'cursor-default text-gray-500' : 'cursor-text hover:bg-gray-50'} ${hasFormula ? 'text-[#0747A6]' : 'text-gray-900'} ${globalSelectMode && !editing ? 'cursor-crosshair' : ''}`}
      >
        {dayBadge && <span className="rounded bg-[#FFF4E0] px-1 text-[10px] font-medium text-[#8F5E00]" title={`Lands on ${dayBadge === 'EOM' ? 'last day of month' : 'day ' + dayBadge}`}>{dayBadge}</span>}
        {hasFormula && <span className="text-[10px] text-[#0747A6]/70">ƒ</span>}
        <span className={resolved < 0 ? 'text-[#BF2600]' : ''}>{fmtMoney(resolved)}</span>
      </div>
      {editing && (
        <div className="absolute inset-0 z-20">
          <input
            ref={inputRef}
            type="text"
            value={editVal}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => setTimeout(finishEdit, 150)}
            onKeyDown={handleKeyDown}
            autoFocus
            className={`h-full w-full border-2 border-[#0075DD] bg-white px-2 text-right text-[13px] focus:outline-none ${isFormula(editVal) ? 'text-left font-mono text-[#0747A6]' : ''}`}
          />
          {isFormula(editVal) && (
            <FormulaAutocomplete editVal={editVal} suggestions={suggestions} onSelect={(s) => replaceTok(s.ref)} selectedIdx={acIdx} months={months} onMonthSelect={(ref, m) => replaceTok(`${ref}.${m}`)} />
          )}
        </div>
      )}
      {!editing && !readOnly && onFillStart && (
        <div
          className="absolute bottom-0 right-0 z-10 h-2 w-2 cursor-crosshair bg-[#0075DD] opacity-0 hover:opacity-100 [td:hover_&]:opacity-100"
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onFillStart(dataKey, index) }}
        />
      )}
    </td>
  )
}

interface Props {
  section: Section
  columns: string[]
  rows: TableRow[]
  totalRow?: { label: string; values: number[] } | null
  extraRows?: { label: string; values: number[] }[]
  rowActions?: ((row: TableRow) => React.ReactNode) | null
  hideTotals?: boolean
  onReorder?: ((dragKey: string, targetKey: string, position: 'before' | 'after') => void) | null
  /** Rows whose displayed values come from `computed` rather than raw cells (debts). */
  computedValues?: Record<string, number[]> | null
  editableComputedKeys?: Record<string, boolean> | null
  enableDayAssignment?: boolean
}

export default function EditableTable({ section, columns, rows, totalRow = null, extraRows = [], rowActions = null, hideTotals = false, onReorder = null, computedValues = null, editableComputedKeys = null, enableDayAssignment = false }: Props) {
  const { data, computed, updateCells, setFlowDay, clearFlowDay, readOnly } = useForecast()
  const bar = useFormulaBar()
  const globalSelectMode = !!bar?.selectMode?.picking
  const { from, to } = computed
  const tableRef = useRef<HTMLTableElement>(null)
  const suggestions = useMemo(() => buildSuggestions(data), [data])
  const [fillState, setFillState] = useState<{ key: string; sourceIdx: number; currentIdx: number } | null>(null)

  // Right-click day assignment
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; key: string; index: number; monthLabel: string; currentDay: FlowDayValue | null; hasDay: boolean } | null>(null)
  const [dayModal, setDayModal] = useState<{ key: string; index: number; monthLabel: string; currentDay: FlowDayValue | null; hasDay: boolean } | null>(null)
  const flowDays = data.flowDays

  const handleCellContextMenu = useCallback((e: React.MouseEvent, sec: Section, key: string, index: number) => {
    if (!enableDayAssignment || readOnly) return
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, key, index, monthLabel: data.months[index] ?? '', currentDay: assignedDay(flowDays, sec, key, index), hasDay: hasAssignedDay(flowDays, sec, key, index) })
  }, [enableDayAssignment, readOnly, data.months, flowDays])

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', close) }
  }, [ctxMenu])

  // Drag-and-drop reorder
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ key: string; position: 'above' | 'below' } | null>(null)
  const categoryOf = useMemo(() => {
    const map: Record<string, string | null> = {}
    if (section !== 'expenses') return map
    let cur: string | null = null
    rows.forEach((r) => { if (r.isHeader) cur = r.key; else map[r.key] = cur })
    return map
  }, [rows, section])

  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDragKey(key)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', key)
    const tr = (e.target as HTMLElement).closest('tr')
    if (tr) e.dataTransfer.setDragImage(tr, 20, tr.offsetHeight / 2)
  }
  const handleDragOver = (e: React.DragEvent, row: TableRow) => {
    if (!dragKey || dragKey === row.key) return
    const dragRow = rows.find((r) => r.key === dragKey)
    if (section === 'expenses' && dragRow?.isHeader && !row.isHeader) return
    if (section === 'expenses' && dragKey.startsWith('_') && categoryOf[row.key] === dragKey) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    let position: 'above' | 'below'
    if (section === 'expenses' && !dragRow?.isHeader && row.isHeader) position = 'below'
    else {
      const rect = e.currentTarget.getBoundingClientRect()
      position = e.clientY - rect.top < rect.height / 2 ? 'above' : 'below'
    }
    setDropTarget({ key: row.key, position })
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (dragKey && dropTarget && onReorder) onReorder(dragKey, dropTarget.key, dropTarget.position === 'above' ? 'before' : 'after')
    setDragKey(null); setDropTarget(null)
  }
  const handleDragEnd = () => { setDragKey(null); setDropTarget(null) }

  // Fill-down
  const handleFillStart = useCallback((key: string, sourceIdx: number) => {
    setFillState({ key, sourceIdx, currentIdx: sourceIdx })
    const handleMove = (e: MouseEvent) => {
      const table = tableRef.current
      if (!table) return
      const cells = table.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(key)}"][data-month-idx]`)
      let closest = sourceIdx
      let closestDist = Infinity
      cells.forEach((cell) => {
        const rect = cell.getBoundingClientRect()
        const dist = Math.abs(e.clientX - (rect.left + rect.width / 2))
        if (dist < closestDist) { closestDist = dist; closest = parseInt(cell.dataset.monthIdx!, 10) }
      })
      setFillState((prev) => (prev ? { ...prev, currentIdx: closest } : null))
    }
    const handleUp = () => {
      setFillState((prev) => {
        if (prev && prev.sourceIdx !== prev.currentIdx) {
          const arr = (data[section] as Record<string, CellValue[] | null>)[prev.key] || []
          const sourceVal = arr[prev.sourceIdx]
          const min = Math.min(prev.sourceIdx, prev.currentIdx)
          const max = Math.max(prev.sourceIdx, prev.currentIdx)
          const entries: { index: number; value: CellValue }[] = []
          for (let i = min; i <= max; i++) {
            if (i === prev.sourceIdx) continue
            entries.push({ index: i, value: isFormula(sourceVal) ? shiftFormulaMonths(sourceVal, i - prev.sourceIdx) : sourceVal || 0 })
          }
          updateCells(section, prev.key, entries)
        }
        return null
      })
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [data, section, updateCells])

  const isFilling = (key: string, absIdx: number) => {
    if (!fillState || fillState.key !== key) return false
    const min = Math.min(fillState.sourceIdx, fillState.currentIdx)
    const max = Math.max(fillState.sourceIdx, fillState.currentIdx)
    return absIdx >= min && absIdx <= max && absIdx !== fillState.sourceIdx
  }

  const handleGlobalCellClick = useCallback((sec: Section, key: string, monthLabel: string | null) => { bar?.insertRef(sec, key, monthLabel) }, [bar])

  const stickyTd = 'sticky left-0 z-10 bg-white border-b border-gray-100 px-4 text-[13px] text-gray-900 whitespace-nowrap'
  const numTd = 'border-b border-gray-100 px-3 text-right text-[13px] tabular-nums'

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null) }}>
      <table ref={tableRef} className="w-full min-w-[640px] border-collapse">
        <thead className="bg-gray-50">
          <tr>
            <th className="sticky left-0 z-10 bg-gray-50 px-4 py-1.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500" style={{ minWidth: 160 }}>Category</th>
            {rowActions && <th className="w-px bg-gray-50" />}
            {columns.map((c) => <th key={c} className="px-3 py-1.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">{c}</th>)}
            {!hideTotals && <th className="px-3 py-1.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500">Total</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isDragBlock = section === 'expenses' && !!dragKey?.startsWith('_')
            const isDragging = dragKey === row.key || (isDragBlock && !row.isHeader && categoryOf[row.key] === dragKey)
            const isDropAbove = dropTarget?.key === row.key && dropTarget.position === 'above'
            const isDropBelow = dropTarget?.key === row.key && dropTarget.position === 'below'
            const rowCls = `${isDragging ? 'opacity-40' : ''} ${isDropAbove ? 'shadow-[inset_0_2px_0_#0075DD]' : ''} ${isDropBelow ? 'shadow-[inset_0_-2px_0_#0075DD]' : ''}`
            const grip = onReorder && !readOnly ? (
              <span draggable onDragStart={(e) => handleDragStart(e, row.key)} onDragEnd={handleDragEnd} className="mr-2 inline-block cursor-grab select-none text-gray-300 hover:text-gray-500" title="Drag to reorder">⋮⋮</span>
            ) : null

            if (row.isHeader) {
              return (
                <tr key={row.key} className={`bg-gray-50/70 ${rowCls}`} onDragOver={(e) => handleDragOver(e, row)} onDrop={handleDrop}>
                  <td className={`${stickyTd} !bg-gray-50/70 py-1.5 text-[12px] font-semibold uppercase tracking-wide text-gray-600`}>{grip}{row.label}</td>
                  {rowActions && <td className="border-b border-gray-100 px-1">{rowActions(row)}</td>}
                  <td className="border-b border-gray-100" colSpan={columns.length + (hideTotals ? 0 : 1)} />
                </tr>
              )
            }

            const rowData = (data[section] as Record<string, CellValue[] | null>)[row.key] || []
            const hasComputed = !!computedValues?.[row.key]
            const viewData = rowData.slice(from, to + 1)
            const resolvedView = hasComputed ? computedValues![row.key].slice(from, to + 1) : viewData.map((v, i) => resolveValue(v, data, from + i))
            const rowTotal = resolvedView.reduce((a, b) => a + b, 0)
            return (
              <tr key={row.key} className={rowCls} onDragOver={(e) => handleDragOver(e, row)} onDrop={handleDrop}>
                <td className={stickyTd}>{grip}{row.label}</td>
                {rowActions && <td className="border-b border-gray-100 px-1 whitespace-nowrap">{rowActions(row)}</td>}
                {viewData.map((val, i) => {
                  const absIdx = from + i
                  const cellReadOnly = readOnly || (hasComputed && absIdx > 0 && !editableComputedKeys?.[row.key])
                  let dayBadge: string | null = null
                  if (enableDayAssignment) {
                    const d = assignedDay(flowDays, section, row.key, absIdx)
                    if (d != null) dayBadge = d === 'last' ? 'EOM' : String(d)
                  }
                  return (
                    <EditableCell
                      key={absIdx}
                      raw={val}
                      resolved={resolvedView[i]}
                      section={section}
                      dataKey={row.key}
                      index={absIdx}
                      suggestions={suggestions}
                      months={data.months}
                      readOnly={cellReadOnly}
                      filling={isFilling(row.key, absIdx)}
                      dayBadge={dayBadge}
                      globalSelectMode={globalSelectMode}
                      onFillStart={cellReadOnly ? undefined : handleFillStart}
                      onGlobalCellClick={handleGlobalCellClick}
                      onContextMenu={enableDayAssignment ? handleCellContextMenu : undefined}
                    />
                  )
                })}
                {!hideTotals && <td className={`${numTd} font-semibold`}>{fmtMoney(rowTotal)}</td>}
              </tr>
            )
          })}

          {totalRow && (
            <tr className="bg-gray-50 font-semibold">
              <td className={`${stickyTd} !bg-gray-50 py-2`}>{totalRow.label}</td>
              {rowActions && <td className="border-b border-gray-100" />}
              {totalRow.values.map((v, i) => <td key={i} className={`${numTd} py-2 ${v < 0 ? 'text-[#BF2600]' : ''}`}>{fmtMoney(v)}</td>)}
              {!hideTotals && <td className={`${numTd} py-2`}>{fmtMoney(totalRow.values.reduce((a, b) => a + b, 0))}</td>}
            </tr>
          )}
          {extraRows.map((r) => {
            const sum = r.values.reduce((a, b) => a + b, 0)
            return (
              <tr key={r.label} className="text-gray-600">
                <td className={`${stickyTd} py-2`}>{r.label}</td>
                {rowActions && <td className="border-b border-gray-100" />}
                {r.values.map((v, i) => <td key={i} className={`${numTd} py-2 ${v >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{fmtMoney(v)}</td>)}
                {!hideTotals && <td className={`${numTd} py-2 ${sum >= 0 ? 'text-[#006644]' : 'text-[#BF2600]'}`}>{fmtMoney(sum)}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>

      {ctxMenu && (
        <div className="fixed z-50 w-56 rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg" style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-3 py-1.5 text-[12px]"><span className="font-medium text-gray-900 truncate">{ctxMenu.key}</span><span className="text-gray-400">{ctxMenu.monthLabel}</span></div>
          <div className="px-3 pb-1.5 text-[12px] text-gray-500">Lands on: <span className="font-medium text-gray-800">{ctxMenu.currentDay == null ? 'Last day (default)' : dayLabel(ctxMenu.currentDay)}</span></div>
          <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-gray-50" onClick={() => { setDayModal({ key: ctxMenu.key, index: ctxMenu.index, monthLabel: ctxMenu.monthLabel, currentDay: ctxMenu.currentDay, hasDay: ctxMenu.hasDay }); setCtxMenu(null) }}>Set day…</button>
          {ctxMenu.hasDay && (
            <button type="button" className="block w-full px-3 py-1.5 text-left text-[#DE350B] hover:bg-gray-50" onClick={() => { clearFlowDay(section, ctxMenu.key, ctxMenu.index); setCtxMenu(null) }}>Clear day</button>
          )}
        </div>
      )}

      {dayModal && (
        <SetDayModal
          open
          row={dayModal.key}
          monthLabel={dayModal.monthLabel}
          currentDay={dayModal.currentDay}
          hasDay={dayModal.hasDay}
          onSave={(day, scope) => { setFlowDay(section, dayModal.key, dayModal.index, day, scope); setDayModal(null) }}
          onClear={() => clearFlowDay(section, dayModal.key, dayModal.index)}
          onClose={() => setDayModal(null)}
        />
      )}
    </div>
  )
}
