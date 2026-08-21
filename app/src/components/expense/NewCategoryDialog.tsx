'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'

interface CategoryOption {
  id: string
  name: string
  groupName: string
}

interface GLAccountOption {
  id: string
  accountNumber: string
  accountName: string
}

interface CreatedCategory {
  id: string
  name: string
  groupName: string
}

interface Props {
  isOpen: boolean
  onClose: () => void
  onCreated: (cat: CreatedCategory) => void
  defaultGroupName?: string
}

const SUGGESTED_GROUPS = [
  'Operating Expenses',
  'Cost of Goods Sold',
  'Personnel',
  'Travel & Meals',
  'Vehicle',
  'Office',
  'Professional Services',
  'Software & Subscriptions',
  'Marketing',
  'Other',
]

export default function NewCategoryDialog({
  isOpen,
  onClose,
  onCreated,
  defaultGroupName = 'Operating Expenses',
}: Props) {
  const [name, setName] = useState('')
  const [groupName, setGroupName] = useState(defaultGroupName)
  const [parentId, setParentId] = useState('')
  const [glAccountId, setGlAccountId] = useState('')
  const [parents, setParents] = useState<CategoryOption[]>([])
  const [glAccounts, setGlAccounts] = useState<GLAccountOption[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    setName('')
    setGroupName(defaultGroupName)
    setParentId('')
    setGlAccountId('')
    setError('')
    fetch('/api/expense-categories')
      .then((r) => r.json())
      .then((d) => setParents(d.data || []))
      .catch(() => {})
    fetch('/api/gl-accounts?class=expense')
      .then((r) => r.json())
      .then((d) => setGlAccounts(d.data || []))
      .catch(() => {})
  }, [isOpen, defaultGroupName])

  async function handleSave() {
    setError('')
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/expense-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          groupName: groupName.trim() || 'Operating Expenses',
          parentId: parentId || null,
          glAccountId: glAccountId || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Save failed')
      }
      const created = await res.json()
      onCreated({
        id: created.id,
        name: created.name,
        groupName: created.groupName,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New Expense Category">
      {error && (
        <div className="mb-3 p-2 bg-[#FDECEA] text-[#BF2600] text-sm rounded">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">
            Name <span className="text-[#BF2600]">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Software Subscriptions"
            autoFocus
            className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">
            Group
          </label>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            list="category-group-suggestions"
            placeholder="Operating Expenses"
            className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
          <datalist id="category-group-suggestions">
            {SUGGESTED_GROUPS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-[#576981]">
            Group categories together on reports (free text — pick existing or
            type a new one).
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">
            Parent Category
          </label>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            <option value="">— None —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.groupName})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[#001B40] mb-1">
            GL Account
          </label>
          <select
            value={glAccountId}
            onChange={(e) => setGlAccountId(e.target.value)}
            className="w-full px-3 py-2 border border-[#E1E6EB] rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            <option value="">— None —</option>
            {glAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountNumber} — {a.accountName}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[#576981]">
            Optional: link to a Chart of Accounts entry so expenses post to the
            ledger automatically.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#E1E6EB]">
        <button
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-sm text-[#576981] hover:text-[#001B40]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Category'}
        </button>
      </div>
    </Modal>
  )
}
