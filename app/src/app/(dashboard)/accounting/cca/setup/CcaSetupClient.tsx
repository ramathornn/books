'use client'

import { useEffect, useState, useCallback } from 'react'

interface AccountOpt {
  id: string
  label: string
  accountClass: string
}

interface ClassRow {
  id: string
  classNumber: string
  description: string
  rate: number
  halfYearRuleApplies: boolean
  accIiEligible: boolean
  immediateExpensingEligible: boolean
  expenseAccountId: string | null
  accumDepAccountId: string | null
  assetAccountId: string | null
  isArchived: boolean
  assetCount: number
  yearCount: number
}

const COMMON = [
  { classNumber: '8', description: 'Furniture, fixtures, equipment', rate: 20 },
  { classNumber: '10', description: 'Vehicles, computer hardware', rate: 30 },
  { classNumber: '50', description: 'Computer equipment & systems software', rate: 55 },
]

const inputCls =
  'h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]'

export default function CcaSetupClient({ accounts }: { accounts: AccountOpt[] }) {
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // new-class form
  const [newClass, setNewClass] = useState({ classNumber: '', description: '', rate: '' })

  const expenseAccts = accounts.filter((a) => a.accountClass === 'expense')
  const liabEquityAssetAccts = accounts.filter((a) => a.accountClass === 'asset')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/cca/classes')
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      setClasses(d.classes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function createClass(c: { classNumber: string; description: string; rate: number | string }) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/cca/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to create')
      setNewClass({ classNumber: '', description: '', rate: '' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  async function patchClass(id: string, patch: Partial<ClassRow>) {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/cca/classes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || 'Failed to save')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const existingNumbers = new Set(classes.map((c) => c.classNumber))

  return (
    <div className="space-y-6">
      {error && <div className="p-3 bg-[#FDECEA] text-[#BF2600] text-sm rounded">{error}</div>}

      {/* Quick-add common classes */}
      <div className="bg-white rounded-lg border border-[#E1E6EB] p-5">
        <h2 className="text-base font-semibold text-[#001B40] mb-3">Add a class</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {COMMON.filter((c) => !existingNumbers.has(c.classNumber)).map((c) => (
            <button
              key={c.classNumber}
              onClick={() => createClass(c)}
              disabled={saving}
              className="px-3 py-1.5 text-xs border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] disabled:opacity-50"
            >
              + Class {c.classNumber} ({c.rate}%) — {c.description}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Class #</span>
            <input
              value={newClass.classNumber}
              onChange={(e) => setNewClass({ ...newClass, classNumber: e.target.value })}
              className={inputCls + ' w-24'}
              placeholder="8"
            />
          </label>
          <label className="block flex-1 min-w-[200px]">
            <span className="block text-xs font-medium text-[#576981] mb-1">Description</span>
            <input
              value={newClass.description}
              onChange={(e) => setNewClass({ ...newClass, description: e.target.value })}
              className={inputCls + ' w-full'}
              placeholder="Furniture, fixtures, equipment"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-[#576981] mb-1">Rate %</span>
            <input
              value={newClass.rate}
              onChange={(e) => setNewClass({ ...newClass, rate: e.target.value })}
              className={inputCls + ' w-24 text-right font-mono'}
              placeholder="20"
            />
          </label>
          <button
            onClick={() => createClass(newClass)}
            disabled={saving || !newClass.classNumber || !newClass.description || !newClass.rate}
            className="px-5 py-2 bg-[#0075DD] hover:bg-[#005FB3] text-white text-sm font-medium rounded disabled:opacity-50"
          >
            Add class
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-[#576981]">Loading…</div>
      ) : (
        classes.map((c) => (
          <div key={c.id} className="bg-white rounded-lg border border-[#E1E6EB] p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-[#001B40]">
                Class {c.classNumber}{' '}
                <span className="font-normal text-[#576981]">{c.description}</span>
              </h3>
              <span className="text-xs text-[#576981]">{c.yearCount} schedule year(s) · {c.assetCount} asset(s)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <label className="block">
                <span className="block text-xs font-medium text-[#576981] mb-1">Rate %</span>
                <input
                  type="number"
                  defaultValue={(c.rate * 100).toFixed(2)}
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value)
                    if (Number.isFinite(v) && Math.abs(v / 100 - c.rate) > 1e-9) patchClass(c.id, { rate: v } as Partial<ClassRow>)
                  }}
                  className={inputCls + ' w-full text-right font-mono'}
                />
              </label>
              <AccountSelect
                label="Depreciation expense (DR)"
                value={c.expenseAccountId}
                options={expenseAccts}
                onChange={(v) => patchClass(c.id, { expenseAccountId: v })}
              />
              <AccountSelect
                label="Accumulated amortization (CR)"
                value={c.accumDepAccountId}
                options={liabEquityAssetAccts}
                onChange={(v) => patchClass(c.id, { accumDepAccountId: v })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <AccountSelect
                label="Asset account (info)"
                value={c.assetAccountId}
                options={liabEquityAssetAccts}
                onChange={(v) => patchClass(c.id, { assetAccountId: v })}
              />
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.halfYearRuleApplies}
                  onChange={(e) => patchClass(c.id, { halfYearRuleApplies: e.target.checked })}
                />
                <span className="text-[#576981]">Half-year rule</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.accIiEligible}
                  onChange={(e) => patchClass(c.id, { accIiEligible: e.target.checked })}
                />
                <span className="text-[#576981]">AccII eligible (uplift)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={c.immediateExpensingEligible}
                  onChange={(e) => patchClass(c.id, { immediateExpensingEligible: e.target.checked })}
                />
                <span className="text-[#576981]">Immediate expensing eligible</span>
              </label>
            </div>

            {(!c.expenseAccountId || !c.accumDepAccountId) && (
              <p className="mt-3 text-xs text-[#BF2600]">
                ⚠ Set both the depreciation expense and accumulated amortization accounts before posting a claim.
              </p>
            )}
          </div>
        ))
      )}
    </div>
  )
}

function AccountSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: AccountOpt[]
  onChange: (v: string | null) => void
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-[#576981] mb-1">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputCls + ' w-full'}
      >
        <option value="">— none —</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
