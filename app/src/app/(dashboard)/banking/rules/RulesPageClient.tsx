'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import RuleEditorDrawer, { type RuleDraft } from './RuleEditorDrawer'

export interface BankAccountOption {
  id: string
  label: string
}
export interface GLAccountOption {
  id: string
  accountNumber: string
  accountName: string
  accountClass: string
}
export interface VendorOption {
  id: string
  name: string
}
export interface CategoryOption {
  id: string
  name: string
  groupName: string
}
export interface TaxCodeOption {
  id: string
  code: string
  name: string
}

export interface Rule {
  id: string
  name: string
  priority: number
  moneyDirection: string
  accountScope: string
  accountIds: string[]
  conditionLogic: string
  conditions: unknown
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

interface Props {
  initialRules: Rule[]
  bankAccounts: BankAccountOption[]
  glAccounts: GLAccountOption[]
  vendors: VendorOption[]
  categories: CategoryOption[]
  taxCodes: TaxCodeOption[]
}

function summarizeConditions(rule: Rule): string {
  const conds = Array.isArray(rule.conditions) ? (rule.conditions as Array<{ field: string; op: string; value: string; matchType?: string }>) : []
  if (conds.length === 0) return '—'
  return conds
    .map((c) => {
      const fieldLabel = c.field === 'bankText' || c.field === 'description' ? 'Bank text' : c.field
      const isText = c.field === 'bankText' || c.field === 'description'
      if (isText && c.matchType === 'regex') {
        return `${fieldLabel} matches /${c.value}/`
      }
      if (isText && c.matchType === 'exact') {
        return `${fieldLabel} is exactly "${c.value}"`
      }
      const opMap: Record<string, string> = {
        contains: 'contains',
        doesNotContain: 'does not contain',
        equals: 'is exactly',
        doesNotEqual: 'is not',
        startsWith: 'starts with',
        endsWith: 'ends with',
        gt: '>',
        lt: '<',
        between: 'between',
      }
      return `${fieldLabel} ${opMap[c.op] || c.op} "${c.value}"`
    })
    .join(rule.conditionLogic === 'all' ? ' AND ' : ' OR ')
}

function summarizeSettings(
  rule: Rule,
  glLookup: Map<string, GLAccountOption>,
  vendorLookup: Map<string, VendorOption>,
  taxLookup: Map<string, TaxCodeOption>
): string {
  const parts: string[] = []
  if (rule.categoryGlAccountId) {
    const gl = glLookup.get(rule.categoryGlAccountId)
    if (gl) parts.push(`Category "${gl.accountNumber} ${gl.accountName}"`)
  }
  if (rule.vendorId) {
    const v = vendorLookup.get(rule.vendorId)
    if (v) parts.push(`Vendor "${v.name}"`)
  }
  if (rule.payee) parts.push(`Payee "${rule.payee}"`)
  if (rule.taxCodeId) {
    const tc = taxLookup.get(rule.taxCodeId)
    if (tc) parts.push(`Tax "${tc.name}"`)
  }
  if (rule.memo) parts.push(`Memo "${rule.memo}"`)
  if (rule.memoAppend) parts.push(`Append memo "${rule.memoAppend}"`)
  return parts.length ? parts.join(', ') : '—'
}

function summarizeAppliedTo(rule: Rule, accountLookup: Map<string, BankAccountOption>): string {
  const dir = rule.moneyDirection === 'in' ? 'Money in' : rule.moneyDirection === 'out' ? 'Money out' : 'Money in/out'
  if (rule.accountScope === 'all' || rule.accountIds.length === 0) {
    return `${dir} · all bank accounts`
  }
  if (rule.accountIds.length === 1) {
    const a = accountLookup.get(rule.accountIds[0])
    return `${dir} · ${a?.label || '—'}`
  }
  return `${dir} · ${rule.accountIds.length} accounts`
}

export default function RulesPageClient({
  initialRules,
  bankAccounts,
  glAccounts,
  vendors,
  categories,
  taxCodes,
}: Props) {
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<RuleDraft | null>(null)
  const [search, setSearch] = useState('')

  const accountLookup = new Map(bankAccounts.map((a) => [a.id, a]))
  const glLookup = new Map(glAccounts.map((g) => [g.id, g]))
  const vendorLookup = new Map(vendors.map((v) => [v.id, v]))
  const taxLookup = new Map(taxCodes.map((t) => [t.id, t]))

  const filtered = search.trim()
    ? initialRules.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    : initialRules

  function ruleToDraft(r: Rule): RuleDraft {
    return {
      id: r.id,
      name: r.name,
      priority: r.priority,
      moneyDirection: r.moneyDirection as 'in' | 'out' | 'both',
      accountScope: r.accountScope as 'all' | 'specific',
      accountIds: r.accountIds,
      conditionLogic: r.conditionLogic as 'all' | 'any',
      conditions: Array.isArray(r.conditions)
        ? (r.conditions as RuleDraft['conditions'])
        : [],
      thenTransactionType: r.thenTransactionType as 'expense' | 'income' | 'transfer' | 'exclude',
      categoryGlAccountId: r.categoryGlAccountId || '',
      vendorId: r.vendorId || '',
      payee: r.payee,
      taxCodeId: r.taxCodeId || '',
      memo: r.memo,
      memoAppend: r.memoAppend,
      autoAdd: r.autoAdd,
      isActive: r.isActive,
    }
  }

  function newDraft(): RuleDraft {
    return {
      id: undefined,
      name: '',
      priority: initialRules.length + 1,
      moneyDirection: 'both',
      accountScope: 'all',
      accountIds: [],
      conditionLogic: 'any',
      conditions: [{ field: 'bankText', op: 'contains', value: '' }],
      thenTransactionType: 'expense',
      categoryGlAccountId: '',
      vendorId: '',
      payee: '',
      taxCodeId: '',
      memo: '',
      memoAppend: '',
      autoAdd: false,
      isActive: true,
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Rules
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            Auto-categorize bank transactions when their description matches a pattern. Rules apply only to unreviewed (Pending) transactions.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(newDraft())
            setDrawerOpen(true)
          }}
          className="px-4 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded"
        >
          New rule
        </button>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-[#E1E6EB]">
          <h2 className="text-sm font-semibold text-[#001B40]">
            {filtered.length} {filtered.length === 1 ? 'rule' : 'rules'}
          </h2>
          <div className="relative w-72">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or condition"
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-[#E1E6EB] rounded focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
            <svg className="w-4 h-4 text-[#8C9BAB] absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-[#576981] mb-4">No bank rules yet.</p>
            <p className="text-xs text-[#8C9BAB]">
              Create rules to automatically categorize incoming bank transactions.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="w-16 px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Priority</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Rule name</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Applied to</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Conditions</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Settings</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-[#576981]">Auto-add</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Status</th>
                  <th className="w-24 px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                    <td className="px-3 py-2.5 text-sm text-[#001B40]">{r.priority}</td>
                    <td className="px-3 py-2.5 text-sm font-medium text-[#001B40]">{r.name}</td>
                    <td className="px-3 py-2.5 text-xs text-[#576981]">{summarizeAppliedTo(r, accountLookup)}</td>
                    <td className="px-3 py-2.5 text-xs text-[#576981] max-w-[280px]">
                      {summarizeConditions(r)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[#576981] max-w-[280px]">
                      {summarizeSettings(r, glLookup, vendorLookup, taxLookup)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-center text-[#576981]">
                      {r.autoAdd ? '✓' : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      <span
                        className="px-2 py-0.5 rounded text-[10px] font-semibold"
                        style={{
                          backgroundColor: r.isActive ? '#E6F4EA' : '#F5F7FA',
                          color: r.isActive ? '#216E39' : '#576981',
                        }}
                      >
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => {
                          setEditing(ruleToDraft(r))
                          setDrawerOpen(true)
                        }}
                        className="text-xs text-[#0075DD] hover:underline"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {drawerOpen && editing && (
        <RuleEditorDrawer
          draft={editing}
          bankAccounts={bankAccounts}
          glAccounts={glAccounts}
          vendors={vendors}
          categories={categories}
          taxCodes={taxCodes}
          onClose={() => {
            setDrawerOpen(false)
            setEditing(null)
          }}
          onSaved={() => {
            setDrawerOpen(false)
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
