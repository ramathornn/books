// Formula engine for cell references and calculations (ported from WealthPilot).
//
// Syntax:
//   =expenses.Rent                    → same month, expenses > Rent
//   =income["Salary (USD)"]           → bracket notation for special chars
//   =receivables.CRAB - expenses.Rent → arithmetic across sections
//   =(income.Salary + income.Bonus) * 0.9
//   =income.Salary.Feb'26             → specific month reference
//   =@personal.income["UGO Dividends"] → a row in another scenario
//   =@"My Plan".expenses.Rent.Feb'26   → quoted when the name has spaces
//
// Supported sections: income, expenses, receivables. Without a month suffix a
// reference resolves to the same month index as the cell being evaluated.
// Cross-scenario refs (@name or @kind) match on calendar month, not index, so
// the two workbooks may cover different date ranges.

import type { CellValue, ExternalScope, ForecastData, Section } from './types'
import { shiftMonthLabel } from './months'

const MAX_DEPTH = 10

type FormulaScope = Pick<ForecastData, 'months' | 'income' | 'expenses' | 'receivables'> & {
  external?: Record<string, ExternalScope>
}

/** Typed money: tolerate thousands separators, currency symbols and (123) negatives. */
export function parseTypedNumber(raw: string): number {
  const t = raw.trim()
  if (!t) return 0
  const neg = /^\(.*\)$/.test(t)
  const n = parseFloat((neg ? t.slice(1, -1) : t).replace(/[$\s,\u00A0'']/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : 0
}

export function isFormula(value: unknown): value is string {
  return typeof value === 'string' && value.trimStart().startsWith('=')
}

export function resolveValue(value: CellValue | null | undefined, data: FormulaScope, monthIndex: number, depth = 0): number {
  if (depth > MAX_DEPTH) return 0
  if (isFormula(value)) return evaluateFormula(value.trimStart().slice(1), data, monthIndex, depth)
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function evaluateFormula(expr: string, data: FormulaScope, monthIndex: number, depth: number): number {
  try {
    const tokens = tokenize(expr)
    if (tokens.length === 0) return 0
    const result = parseExpression(tokens, 0, data, monthIndex, depth)
    return Number.isFinite(result.value) ? result.value : 0
  } catch {
    return 0
  }
}

/** Shift every explicit ".Mon'YY" reference in a formula by `offset` months (fill-down). */
export function shiftFormulaMonths(formula: string, offset: number): string {
  if (!isFormula(formula) || offset === 0) return formula
  return formula.replace(/\.([A-Z][a-z]{2})'(\d{2})(?=[^a-zA-Z0-9_]|$)/g, (_m, month: string, year: string) => {
    return `.${shiftMonthLabel(`${month}'${year}`, offset)}`
  })
}

// ─── Tokenizer ──────────────────────────────────────────────

type Token =
  | { type: 'op'; value: string }
  | { type: 'num'; value: number }
  | { type: 'ref'; section: string; row: string; monthLabel: string | null; scenario: string | null }

const MONTH_SUFFIX = /^([A-Z][a-z]{2})'(\d{2})/

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const len = expr.length

  while (i < len) {
    const ch = expr[i]
    if (/\s/.test(ch)) { i++; continue }
    if ('+-*/()'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i++; continue }
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < len && /[0-9.]/.test(expr[i])) { num += expr[i]; i++ }
      tokens.push({ type: 'num', value: parseFloat(num) || 0 })
      continue
    }
    if (ch === '@') {
      const sc = readScenarioName(expr, i + 1)
      i = sc.end
      if (i < len && expr[i] === '.') i++
      const ref = readRef(expr, i, sc.name)
      i = ref.end
      tokens.push(ref.token)
      continue
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const ref = readRef(expr, i, null)
      i = ref.end
      tokens.push(ref.token)
      continue
    }
    i++
  }
  return tokens
}

/** `section.row` or `section["row"]`, with an optional `.Mon'YY` suffix. */
function readRef(expr: string, start: number, scenario: string | null): { token: Token; end: number } {
  const len = expr.length
  let i = start
  let word = ''
  while (i < len && /[a-zA-Z_]/.test(expr[i])) { word += expr[i]; i++ }
  if (i >= len || (expr[i] !== '.' && expr[i] !== '[')) return { token: { type: 'num', value: 0 }, end: i }
  let row: { name: string; end: number }
  if (expr[i] === '.') { i++; row = readRowName(expr, i) } else { i++; row = readBracketName(expr, i) }
  i = row.end
  let monthLabel: string | null = null
  if (i < len && expr[i] === '.') {
    const mm = expr.slice(i + 1).match(MONTH_SUFFIX)
    if (mm) { monthLabel = `${mm[1]}'${mm[2]}`; i += 1 + mm[0].length }
  }
  return { token: { type: 'ref', section: word.toLowerCase(), row: row.name, monthLabel, scenario }, end: i }
}

/** The name after "@": a bare word, or "quoted" when it has spaces. */
function readScenarioName(expr: string, start: number): { name: string; end: number } {
  const len = expr.length
  let i = start
  let name = ''
  if (i < len && expr[i] === '"') {
    i++
    while (i < len && expr[i] !== '"') { name += expr[i]; i++ }
    if (i < len) i++
  } else {
    while (i < len && /[a-zA-Z0-9_]/.test(expr[i])) { name += expr[i]; i++ }
  }
  return { name: name.trim(), end: i }
}

function readRowName(expr: string, start: number): { name: string; end: number } {
  let i = start
  const len = expr.length
  if (i < len && expr[i] === '[') return readBracketName(expr, i + 1)
  let name = ''
  while (i < len && !/[+\-*/()]/.test(expr[i])) {
    if (expr[i] === '.' && MONTH_SUFFIX.test(expr.slice(i + 1))) break
    name += expr[i]
    i++
  }
  return { name: name.trim(), end: i }
}

function readBracketName(expr: string, start: number): { name: string; end: number } {
  let i = start
  const len = expr.length
  let name = ''
  if (i < len && expr[i] === '"') i++
  while (i < len && expr[i] !== ']' && expr[i] !== '"') { name += expr[i]; i++ }
  if (i < len && expr[i] === '"') i++
  if (i < len && expr[i] === ']') i++
  return { name: name.trim(), end: i }
}

// ─── Recursive descent parser ───────────────────────────────

interface ParseResult { value: number; pos: number }

function parseExpression(tokens: Token[], pos: number, data: FormulaScope, monthIndex: number, depth: number): ParseResult {
  let left = parseTerm(tokens, pos, data, monthIndex, depth)
  while (left.pos < tokens.length) {
    const tok = tokens[left.pos]
    if (tok.type !== 'op' || (tok.value !== '+' && tok.value !== '-')) break
    const right = parseTerm(tokens, left.pos + 1, data, monthIndex, depth)
    left = { value: tok.value === '+' ? left.value + right.value : left.value - right.value, pos: right.pos }
  }
  return left
}

function parseTerm(tokens: Token[], pos: number, data: FormulaScope, monthIndex: number, depth: number): ParseResult {
  let left = parseFactor(tokens, pos, data, monthIndex, depth)
  while (left.pos < tokens.length) {
    const tok = tokens[left.pos]
    if (tok.type !== 'op' || (tok.value !== '*' && tok.value !== '/')) break
    const right = parseFactor(tokens, left.pos + 1, data, monthIndex, depth)
    left = {
      value: tok.value === '*' ? left.value * right.value : right.value !== 0 ? left.value / right.value : 0,
      pos: right.pos,
    }
  }
  return left
}

function parseFactor(tokens: Token[], pos: number, data: FormulaScope, monthIndex: number, depth: number): ParseResult {
  if (pos >= tokens.length) return { value: 0, pos }
  const tok = tokens[pos]
  if (tok.type === 'op' && tok.value === '-') {
    const r = parseFactor(tokens, pos + 1, data, monthIndex, depth)
    return { value: -r.value, pos: r.pos }
  }
  if (tok.type === 'op' && tok.value === '(') {
    const r = parseExpression(tokens, pos + 1, data, monthIndex, depth)
    const next = tokens[r.pos]
    const nextPos = next && next.type === 'op' && next.value === ')' ? r.pos + 1 : r.pos
    return { value: r.value, pos: nextPos }
  }
  if (tok.type === 'num') return { value: tok.value, pos: pos + 1 }
  if (tok.type === 'ref') {
    const section = tok.section as Section
    if (section !== 'income' && section !== 'expenses' && section !== 'receivables') return { value: 0, pos: pos + 1 }

    // A sibling scenario keeps its own months, so line them up by calendar
    // month rather than by index.
    if (tok.scenario) {
      const ext = data.external?.[tok.scenario.toLowerCase()]
      if (!ext) return { value: 0, pos: pos + 1 }
      const label = tok.monthLabel ?? data.months[monthIndex]
      const idx = label ? ext.months.indexOf(label) : -1
      if (idx < 0) return { value: 0, pos: pos + 1 }
      const extArr = (ext[section] as Record<string, CellValue[] | null>)[tok.row]
      if (!extArr) return { value: 0, pos: pos + 1 }
      const extScope: FormulaScope = { months: ext.months, income: ext.income, expenses: ext.expenses, receivables: ext.receivables, external: data.external }
      return { value: resolveValue(extArr[idx], extScope, idx, depth + 1), pos: pos + 1 }
    }

    const arr = (data[section] as Record<string, CellValue[] | null>)[tok.row]
    if (arr) {
      let idx = monthIndex
      if (tok.monthLabel) {
        const found = data.months.indexOf(tok.monthLabel)
        if (found >= 0) idx = found
      }
      return { value: resolveValue(arr[idx], data, idx, depth + 1), pos: pos + 1 }
    }
    return { value: 0, pos: pos + 1 }
  }
  return { value: 0, pos: pos + 1 }
}

/** Raw formula text for display (without trimming the "="), or null for literals. */
export function getFormulaDisplay(value: CellValue | null | undefined): string | null {
  return isFormula(value) ? value.trimStart() : null
}

/** Build a reference string for a cell, bracket-quoting names with special characters. */
export function buildCellRef(section: Section, key: string, monthLabel: string | null = null, scenario: string | null = null): string {
  const needsBrackets = /[^a-zA-Z0-9_]/.test(key)
  let ref = needsBrackets ? `${section}["${key}"]` : `${section}.${key}`
  if (monthLabel) ref += `.${monthLabel}`
  if (scenario) ref = `@${/[^a-zA-Z0-9_]/.test(scenario) ? `"${scenario}"` : scenario}.${ref}`
  return ref
}

/**
 * How to name `scenario` inside a formula: its kind ("personal" / "business")
 * when that is unambiguous, otherwise its name.
 */
export function scenarioQualifier(
  scenario: { name: string; kind: 'personal' | 'business' },
  all: { kind: 'personal' | 'business' }[]
): string {
  return all.filter((s) => s.kind === scenario.kind).length === 1 ? scenario.kind : scenario.name
}

// ─── Autocomplete helpers (shared by the cell editor and the formula bar) ──

export interface RefSuggestion { ref: string; section: Section; key: string; scenario?: string }

export function buildSuggestions(data: FormulaScope): RefSuggestion[] {
  const out: RefSuggestion[] = []
  const sections: Section[] = ['income', 'expenses', 'receivables']
  for (const section of sections) {
    const rows = data[section] as Record<string, CellValue[] | null>
    for (const key of Object.keys(rows)) {
      if (key.startsWith('_') || rows[key] === null) continue
      out.push({ ref: buildCellRef(section, key), section, key })
    }
  }
  for (const { scope, qualifier } of externalScopes(data)) {
    for (const section of sections) {
      const rows = scope[section] as Record<string, CellValue[] | null>
      for (const key of Object.keys(rows)) {
        if (key.startsWith('_') || rows[key] === null) continue
        out.push({ ref: buildCellRef(section, key, null, qualifier), section, key, scenario: scope.name })
      }
    }
  }
  return out
}

/**
 * Sibling scenarios, de-duplicated (the map holds each one under both its name
 * and its kind). Refs use the kind when it is unambiguous, else the name.
 */
export function externalScopes(data: FormulaScope): { scope: ExternalScope; qualifier: string }[] {
  const seen = new Set<ExternalScope>()
  const scopes: ExternalScope[] = []
  for (const scope of Object.values(data.external ?? {})) {
    if (seen.has(scope)) continue
    seen.add(scope)
    scopes.push(scope)
  }
  const kindCount = new Map<string, number>()
  for (const s of scopes) kindCount.set(s.kind, (kindCount.get(s.kind) ?? 0) + 1)
  return scopes.map((scope) => ({ scope, qualifier: kindCount.get(scope.kind) === 1 ? scope.kind : scope.name }))
}

/** The token currently being typed (text after the last operator or "="). */
export function getCurrentToken(val: string): string {
  let lastOp = -1
  for (let i = val.length - 1; i >= 0; i--) {
    if ('=+-*/('.includes(val[i])) { lastOp = i; break }
  }
  return val.slice(lastOp + 1).trimStart()
}

/** If the token is a complete ref followed by ".", return the ref and the partial month text. */
export function getMonthPartial(token: string): { ref: string; partial: string } | null {
  const bracket = token.match(/^((?:income|expenses|receivables)\["[^"]*"\])\.(.*)/i)
  if (bracket) return { ref: bracket[1], partial: bracket[2] }
  const dot = token.match(/^((?:income|expenses|receivables)\.[a-zA-Z0-9_]+)\.(.*)/i)
  if (dot) return { ref: dot[1], partial: dot[2] }
  return null
}

/** Replace the trailing token of `val` with `newToken`, preserving the operator prefix. */
export function replaceCurrentToken(val: string, newToken: string): string {
  let lastOp = -1
  for (let i = val.length - 1; i >= 0; i--) {
    if ('=+-*/('.includes(val[i])) { lastOp = i; break }
  }
  const prefix = val.slice(0, lastOp + 1)
  const space = prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('=') ? ' ' : ''
  return prefix + space + newToken
}
