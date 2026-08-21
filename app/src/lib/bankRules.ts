// Rule engine: evaluate a candidate bank transaction against a list of BankRules
// and return the highest-priority match. Standard bank-rules semantics: first match by priority wins.

import { normalizeMerchant } from '@/lib/vendorMatch'

export type RuleField = 'bankText' | 'description' | 'merchant' | 'amount' | 'amountSign' | 'date'
export type RuleOp =
  | 'contains'
  | 'doesNotContain'
  | 'equals'
  | 'doesNotEqual'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'lt'
  | 'between'

// How a string condition's value is interpreted:
//   contains — substring match via the op (default; legacy behaviour)
//   exact    — whole-string equality (case-insensitive)
//   regex    — value is a JS regex pattern, matched case-insensitively
export type MatchType = 'exact' | 'contains' | 'regex'

export interface RuleCondition {
  field: RuleField
  op: RuleOp
  value: string | number
  valueEnd?: string | number // for 'between'
  matchType?: MatchType // string-field conditions only; default 'contains'
}

export interface RuleAction {
  thenTransactionType: 'expense' | 'income' | 'transfer' | 'exclude'
  categoryGlAccountId?: string | null
  categoryId?: string | null
  vendorId?: string | null
  payee?: string
  taxCodeId?: string | null
  memo?: string
  memoAppend?: string
  splits?: Array<{ categoryGlAccountId: string; amount?: number; percent?: number; taxCodeId?: string | null }>
  autoAdd?: boolean
}

export interface BankRuleLite {
  id: string
  name: string
  priority: number
  moneyDirection: string // in | out | both
  accountScope: string // all | specific
  accountIds: string[]
  conditionLogic: string // all | any
  conditions: unknown // JSON
  // Simple text-match shorthand (used when `conditions` is empty):
  pattern?: string // text/regex to match against the bank description
  matchType?: string // exact | contains | regex (default contains)
  thenTransactionType: string
  categoryGlAccountId: string | null
  categoryId: string | null
  vendorId: string | null
  payee: string
  taxCodeId: string | null
  memo: string
  memoAppend: string
  splits: unknown
  autoAdd: boolean
  isActive: boolean
}

export interface BankTxLite {
  bankAccountId: string
  amount: number
  description: string
  payee?: string
  transactionDate: Date
}

// Compile a user-supplied regex safely. Invalid patterns (or empty) yield null,
// which callers treat as "no match" — we never throw on a bad pattern.
export function safeCompileRegex(pattern: string): RegExp | null {
  if (!pattern) return null
  try {
    return new RegExp(pattern, 'i')
  } catch {
    return null
  }
}

// Whether `pattern` is a valid JS regex (used by the UI for live validation).
export function isValidRegex(pattern: string): boolean {
  if (!pattern) return false
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

function stringMatch(
  haystack: string,
  op: RuleOp,
  needle: string,
  matchType: MatchType = 'contains'
): boolean {
  // Regex match type ignores the op: the value IS the pattern. A pattern that
  // fails to compile is treated as no-match (never throws).
  if (matchType === 'regex') {
    const re = safeCompileRegex(needle)
    if (!re) return false
    const matched = re.test(haystack)
    // Honour negated ops so "doesn't contain" + regex => "doesn't match".
    return op === 'doesNotContain' || op === 'doesNotEqual' ? !matched : matched
  }

  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()

  // Exact match type forces whole-string (in)equality regardless of op,
  // except the explicit negation ops.
  if (matchType === 'exact') {
    const eq = h === n
    return op === 'doesNotContain' || op === 'doesNotEqual' ? !eq : eq
  }

  switch (op) {
    case 'contains': return h.includes(n)
    case 'doesNotContain': return !h.includes(n)
    case 'equals': return h === n
    case 'doesNotEqual': return h !== n
    case 'startsWith': return h.startsWith(n)
    case 'endsWith': return h.endsWith(n)
    default: return false
  }
}

function numberMatch(value: number, op: RuleOp, target: number, targetEnd?: number): boolean {
  switch (op) {
    case 'equals': return value === target
    case 'doesNotEqual': return value !== target
    case 'gt': return value > target
    case 'lt': return value < target
    case 'between': return targetEnd !== undefined && value >= Math.min(target, targetEnd) && value <= Math.max(target, targetEnd)
    default: return false
  }
}

function evalCondition(c: RuleCondition, tx: BankTxLite): boolean {
  switch (c.field) {
    case 'bankText':
    case 'description':
      return stringMatch(tx.description || '', c.op, String(c.value), c.matchType ?? 'contains')
    case 'merchant':
      // Match against the normalised merchant (payee, else description) so one
      // robust rule fires across a merchant's descriptor variants ("DNH*GODADDY",
      // "GoDaddy.com") — the rule value is compared case/punct-insensitively.
      return stringMatch(
        normalizeMerchant(tx.payee || tx.description),
        c.op,
        normalizeMerchant(String(c.value)),
        c.matchType ?? 'contains'
      )
    case 'amount':
      return numberMatch(Math.abs(tx.amount), c.op, Number(c.value), c.valueEnd !== undefined ? Number(c.valueEnd) : undefined)
    case 'amountSign': {
      // value should be 'in' or 'out'; check sign of tx.amount
      const v = String(c.value).toLowerCase()
      if (v === 'in' || v === 'positive') return tx.amount > 0
      if (v === 'out' || v === 'negative') return tx.amount < 0
      return false
    }
    case 'date': {
      // value should be ISO date string; compare date-only
      const txDate = tx.transactionDate.toISOString().slice(0, 10)
      return stringMatch(txDate, c.op, String(c.value))
    }
    default:
      return false
  }
}

export function ruleMatches(rule: BankRuleLite, tx: BankTxLite): boolean {
  if (!rule.isActive) return false

  // Money direction
  if (rule.moneyDirection === 'in' && tx.amount <= 0) return false
  if (rule.moneyDirection === 'out' && tx.amount >= 0) return false

  // Account scope
  if (rule.accountScope === 'specific' && rule.accountIds.length > 0) {
    if (!rule.accountIds.includes(tx.bankAccountId)) return false
  }

  const conds = Array.isArray(rule.conditions) ? (rule.conditions as RuleCondition[]) : []

  // Shorthand: a rule with no structured conditions but a `pattern` matches the
  // bank description using the rule-level matchType.
  if (conds.length === 0) {
    const pattern = (rule.pattern ?? '').trim()
    if (!pattern) return false
    const mt = (rule.matchType as MatchType) || 'contains'
    return stringMatch(tx.description || '', 'contains', pattern, mt)
  }

  if (rule.conditionLogic === 'all') {
    return conds.every((c) => evalCondition(c, tx))
  }
  return conds.some((c) => evalCondition(c, tx))
}

export function findBestRule(rules: BankRuleLite[], tx: BankTxLite): BankRuleLite | null {
  // Higher priority wins. If equal priority, first match wins (stable sort).
  const sorted = [...rules].sort((a, b) => b.priority - a.priority)
  for (const r of sorted) {
    if (ruleMatches(r, tx)) return r
  }
  return null
}
