'use client'

import { useEffect, useState } from 'react'
import type {
  BankAccountOption,
  GLAccountOption,
  VendorOption,
  CategoryOption,
  TaxCodeOption,
} from './RulesPageClient'

export type MatchType = 'exact' | 'contains' | 'regex'

export interface RuleCondition {
  field: 'bankText' | 'description' | 'amount' | 'amountSign' | 'date'
  op:
    | 'contains'
    | 'doesNotContain'
    | 'equals'
    | 'doesNotEqual'
    | 'startsWith'
    | 'endsWith'
    | 'gt'
    | 'lt'
    | 'between'
  value: string
  valueEnd?: string
  matchType?: MatchType // string-field conditions only; default 'contains'
}

// True if `pattern` compiles as a JS regex (client-side live validation).
function isValidRegex(pattern: string): boolean {
  if (!pattern) return false
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

// Match-type only applies to text fields.
function isTextField(field: RuleCondition['field']): boolean {
  return field === 'bankText' || field === 'description'
}

export interface RuleDraft {
  id?: string
  name: string
  priority: number
  moneyDirection: 'in' | 'out' | 'both'
  accountScope: 'all' | 'specific'
  accountIds: string[]
  conditionLogic: 'all' | 'any'
  conditions: RuleCondition[]
  thenTransactionType: 'expense' | 'income' | 'transfer' | 'exclude'
  categoryGlAccountId: string
  vendorId: string
  payee: string
  taxCodeId: string
  memo: string
  memoAppend: string
  autoAdd: boolean
  isActive: boolean
}

interface Props {
  draft: RuleDraft
  bankAccounts: BankAccountOption[]
  glAccounts: GLAccountOption[]
  vendors: VendorOption[]
  categories: CategoryOption[]
  taxCodes: TaxCodeOption[]
  onClose: () => void
  onSaved: () => void
}

const FIELDS: { value: RuleCondition['field']; label: string }[] = [
  { value: 'bankText', label: 'Bank text' },
  { value: 'description', label: 'Description' },
  { value: 'amount', label: 'Amount' },
  { value: 'amountSign', label: 'Direction' },
  { value: 'date', label: 'Date' },
]

const STRING_OPS: { value: RuleCondition['op']; label: string }[] = [
  { value: 'contains', label: 'Contains' },
  { value: 'doesNotContain', label: "Doesn't contain" },
  { value: 'equals', label: 'Is exactly' },
  { value: 'doesNotEqual', label: 'Is not' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
]

const NUMBER_OPS: { value: RuleCondition['op']; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'doesNotEqual', label: 'Does not equal' },
  { value: 'gt', label: 'Greater than' },
  { value: 'lt', label: 'Less than' },
  { value: 'between', label: 'Between' },
]

function opsForField(field: RuleCondition['field']) {
  if (field === 'amount') return NUMBER_OPS
  if (field === 'amountSign')
    return [{ value: 'equals' as const, label: 'Is' }]
  return STRING_OPS
}

export default function RuleEditorDrawer({
  draft: initial,
  bankAccounts,
  glAccounts,
  vendors,
  taxCodes,
  onClose,
  onSaved,
}: Props) {
  const [draft, setDraft] = useState<RuleDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    matchCount: number
    pendingCount: number
    sample: Array<{ id: string; date: string; description: string; amount: number }>
  } | null>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  function update<K extends keyof RuleDraft>(k: K, v: RuleDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  function updateCondition(i: number, c: Partial<RuleCondition>) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((x, idx) => (idx === i ? { ...x, ...c } : x)),
    }))
  }

  function addCondition() {
    setDraft((d) => ({
      ...d,
      conditions: [...d.conditions, { field: 'bankText', op: 'contains', value: '' }],
    }))
  }

  function removeCondition(i: number) {
    setDraft((d) => ({ ...d, conditions: d.conditions.filter((_, idx) => idx !== i) }))
  }

  function payload() {
    return {
      ...draft,
      categoryGlAccountId: draft.categoryGlAccountId || null,
      vendorId: draft.vendorId || null,
      taxCodeId: draft.taxCodeId || null,
      categoryId: null,
      splits: [],
    }
  }

  async function save() {
    setError('')
    if (!draft.name.trim()) {
      setError('Name is required.')
      return
    }
    if (draft.conditions.length === 0 || draft.conditions.every((c) => !c.value.trim())) {
      setError('Add at least one condition with a value.')
      return
    }
    const badRegex = draft.conditions.find(
      (c) =>
        isTextField(c.field) &&
        c.matchType === 'regex' &&
        c.value.trim() !== '' &&
        !isValidRegex(c.value)
    )
    if (badRegex) {
      setError(`Invalid regex pattern: "${badRegex.value}"`)
      return
    }
    setSaving(true)
    try {
      const url = draft.id ? `/api/bank-rules/${draft.id}` : '/api/bank-rules'
      const method = draft.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!draft.id) return
    if (!confirm('Delete this rule?')) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/bank-rules/${draft.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/bank-rules/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload()),
      })
      if (!res.ok) throw new Error('Test failed')
      setTestResult(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  // Group GL accounts by class for the category picker
  const glByClass = glAccounts.reduce((acc, g) => {
    if (!acc[g.accountClass]) acc[g.accountClass] = []
    acc[g.accountClass].push(g)
    return acc
  }, {} as Record<string, GLAccountOption[]>)

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-[480px] bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#E1E6EB]">
          <h2 className="text-base font-semibold text-[#001B40]">
            {draft.id ? 'Edit rule' : 'Create rule'}
          </h2>
          <button onClick={onClose} className="text-[#576981] hover:text-[#001B40]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <p className="text-xs text-[#576981] px-5 pt-3 -mb-2">
          Rules only apply to unreviewed transactions.
        </p>

        <div className="p-5 space-y-5 flex-1">
          {error && (
            <div className="p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>
          )}

          {/* Section 1 — Name */}
          <Field label="What do you want to call this rule?" required>
            <input
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Name this rule"
              autoFocus
              className={inputCls + ' border-[#0075DD]'}
            />
          </Field>

          {/* Section 2 — Apply this to transactions that are */}
          <div>
            <div className="text-sm font-medium text-[#001B40] mb-2">Apply this to transactions that are</div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={draft.moneyDirection}
                onChange={(e) => update('moneyDirection', e.target.value as RuleDraft['moneyDirection'])}
                className={inputCls + ' bg-white'}
              >
                <option value="both">Money in/out</option>
                <option value="in">Money in</option>
                <option value="out">Money out</option>
              </select>
              <select
                value={draft.accountScope === 'all' ? '__all__' : draft.accountIds[0] || '__all__'}
                onChange={(e) => {
                  if (e.target.value === '__all__') {
                    setDraft((d) => ({ ...d, accountScope: 'all', accountIds: [] }))
                  } else {
                    setDraft((d) => ({ ...d, accountScope: 'specific', accountIds: [e.target.value] }))
                  }
                }}
                className={inputCls + ' bg-white'}
              >
                <option value="__all__">All bank accounts</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 3 — Conditions */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-[#001B40]">and include the following:</div>
              <select
                value={draft.conditionLogic}
                onChange={(e) => update('conditionLogic', e.target.value as 'all' | 'any')}
                className="h-7 px-2 text-xs border border-[#E1E6EB] rounded bg-white"
              >
                <option value="any">Any (OR)</option>
                <option value="all">All (AND)</option>
              </select>
            </div>

            <div className="space-y-2">
              {draft.conditions.map((c, i) => {
                const ops = opsForField(c.field)
                const textField = isTextField(c.field)
                const matchType: MatchType = c.matchType ?? 'contains'
                const isRegex = textField && matchType === 'regex'
                const regexBad = isRegex && c.value.trim() !== '' && !isValidRegex(c.value)
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <select
                        value={c.field}
                        onChange={(e) => updateCondition(i, { field: e.target.value as RuleCondition['field'] })}
                        className="h-9 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                      >
                        {FIELDS.map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                      {/* Match-type picker — text fields only. Regex treats the value as a pattern. */}
                      {textField && (
                        <select
                          value={matchType}
                          onChange={(e) => updateCondition(i, { matchType: e.target.value as MatchType })}
                          className="h-9 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                          title="How to interpret the value"
                        >
                          <option value="contains">Text</option>
                          <option value="exact">Exact</option>
                          <option value="regex">Regex</option>
                        </select>
                      )}
                      {/* Op selector — hidden for regex (the pattern is the whole match). */}
                      {!isRegex && (
                        <select
                          value={c.op}
                          onChange={(e) => updateCondition(i, { op: e.target.value as RuleCondition['op'] })}
                          className="h-9 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                        >
                          {ops.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      )}
                      {c.field === 'amountSign' ? (
                        <select
                          value={c.value}
                          onChange={(e) => updateCondition(i, { value: e.target.value })}
                          className="flex-1 h-9 px-2 text-sm border border-[#E1E6EB] rounded bg-white"
                        >
                          <option value="">—</option>
                          <option value="in">Money in</option>
                          <option value="out">Money out</option>
                        </select>
                      ) : (
                        <input
                          value={c.value}
                          onChange={(e) => updateCondition(i, { value: e.target.value })}
                          placeholder={isRegex ? '^pattern.*$' : 'Enter text'}
                          spellCheck={!isRegex}
                          className={
                            'flex-1 h-9 px-3 text-sm border rounded focus:outline-none focus:ring-1 ' +
                            (isRegex ? 'font-mono ' : '') +
                            (regexBad
                              ? 'border-[#BF2600] focus:ring-[#BF2600]'
                              : 'border-[#E1E6EB] focus:ring-[#0075DD]')
                          }
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => removeCondition(i)}
                        className="text-[#576981] hover:text-[#BF2600] text-sm px-1"
                        aria-label="Remove condition"
                      >
                        ×
                      </button>
                    </div>
                    {isRegex && (
                      <div className="pl-1 text-[11px]">
                        {c.value.trim() === '' ? (
                          <span className="text-[#8C9BAB]">Case-insensitive JavaScript regex.</span>
                        ) : regexBad ? (
                          <span className="text-[#BF2600]">Invalid regex pattern.</span>
                        ) : (
                          <span className="text-[#216E39]">Valid regex.</span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={addCondition}
                className="text-xs text-[#0075DD] hover:underline"
              >
                + Add a condition
              </button>
              <button
                type="button"
                onClick={test}
                disabled={testing}
                className="ml-auto px-3 py-1 text-xs font-medium border border-[#2FA84F] text-[#2FA84F] rounded hover:bg-[#E6F4EA] disabled:opacity-50"
              >
                {testing ? 'Testing…' : 'Test rule'}
              </button>
            </div>

            {testResult && (
              <div className="mt-2 p-2 rounded bg-[#F5F7FA] text-xs text-[#001B40]">
                Matches <strong>{testResult.matchCount}</strong> of {testResult.pendingCount} pending tx.
                {testResult.sample.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {testResult.sample.map((s) => (
                      <li key={s.id} className="text-[#576981] truncate">
                        {s.date} · {s.description.slice(0, 60)} · ${s.amount.toFixed(2)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Section 4 — Then */}
          <div>
            <div className="text-sm font-medium text-[#001B40] mb-2">Then</div>

            <Field label="Transaction type">
              <select
                value={draft.thenTransactionType}
                onChange={(e) => update('thenTransactionType', e.target.value as RuleDraft['thenTransactionType'])}
                className={inputCls + ' bg-white'}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
                <option value="exclude">Exclude (skip)</option>
              </select>
            </Field>

            <Field label="Category (GL account)">
              <select
                value={draft.categoryGlAccountId}
                onChange={(e) => update('categoryGlAccountId', e.target.value)}
                className={inputCls + ' bg-white'}
              >
                <option value="">Select a category</option>
                {Object.entries(glByClass).map(([cls, accts]) => (
                  <optgroup key={cls} label={cls.charAt(0).toUpperCase() + cls.slice(1)}>
                    {accts.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.accountNumber} · {g.accountName}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Vendor">
                <select
                  value={draft.vendorId}
                  onChange={(e) => update('vendorId', e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">— None —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Tax code">
                <select
                  value={draft.taxCodeId}
                  onChange={(e) => update('taxCodeId', e.target.value)}
                  className={inputCls + ' bg-white'}
                >
                  <option value="">— None —</option>
                  {taxCodes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Payee (free text)">
              <input
                value={draft.payee}
                onChange={(e) => update('payee', e.target.value)}
                placeholder="Optional payee label"
                className={inputCls}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Set memo">
                <input
                  value={draft.memo}
                  onChange={(e) => update('memo', e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Append to memo">
                <input
                  value={draft.memoAppend}
                  onChange={(e) => update('memoAppend', e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>

            <div className="mt-2 space-y-2">
              <label className="flex items-center gap-2 text-sm text-[#001B40]">
                <input
                  type="checkbox"
                  checked={draft.autoAdd}
                  onChange={(e) => update('autoAdd', e.target.checked)}
                  className="rounded border-[#E1E6EB]"
                />
                Auto-add: post matching transactions immediately (skip review)
              </label>
              <label className="flex items-center gap-2 text-sm text-[#001B40]">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) => update('isActive', e.target.checked)}
                  className="rounded border-[#E1E6EB]"
                />
                Active
              </label>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[#E1E6EB] flex items-center justify-between">
          {draft.id ? (
            <button
              onClick={remove}
              disabled={deleting || saving}
              className="text-xs text-[#BF2600] hover:underline"
            >
              {deleting ? 'Deleting…' : 'Delete rule'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-[#576981] mb-1">
        {label}
        {required && <span className="text-[#BF2600] ml-1">*</span>}
      </span>
      {children}
    </label>
  )
}
