'use client'

import { useState } from 'react'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

export interface EmailTemplateRow {
  id: string
  name: string
  subject: string
  body: string
}

interface EmailTemplatesSettingsProps {
  initial: EmailTemplateRow[]
}

const SHORTCODES = [
  ['{{invoice.link}}', 'invoice link pill'],
  ['{{invoice.number}}', 'invoice number'],
  ['{{invoice.amount}}', 'amount due'],
  ['{{invoice.dueDate}}', 'due date'],
]

export default function EmailTemplatesSettings({
  initial,
}: EmailTemplatesSettingsProps) {
  const [templates, setTemplates] = useState<EmailTemplateRow[]>(initial)
  const [editing, setEditing] = useState<EmailTemplateRow | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const { confirm, dialog } = useConfirm()

  function startNew() {
    setIsNew(true)
    setEditing({
      id: '',
      name: '',
      subject: 'Invoice {{invoice.number}}',
      body: 'Hi,\n\nYour invoice {{invoice.number}} for {{invoice.amount}} is due on {{invoice.dueDate}}. You can view and pay it here: {{invoice.link}}\n\nThank you.',
    })
  }

  async function handleSave() {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(
        isNew ? '/api/email-templates' : `/api/email-templates/${editing.id}`,
        {
          method: isNew ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editing.name,
            subject: editing.subject,
            body: editing.body,
          }),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setTemplates((prev) =>
          isNew
            ? [...prev, data.data]
            : prev.map((t) => (t.id === data.data.id ? data.data : t))
        )
        setEditing(null)
        toast.success(isNew ? 'Template created' : 'Template saved')
      } else {
        toast.error(data.error || 'Failed to save template')
      }
    } catch {
      toast.error('Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete(t: EmailTemplateRow) {
    confirm({
      title: 'Delete template',
      message: `Delete the "${t.name}" template? This cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        try {
          const res = await fetch(`/api/email-templates/${t.id}`, {
            method: 'DELETE',
          })
          if (res.ok) {
            setTemplates((prev) => prev.filter((x) => x.id !== t.id))
          } else {
            const data = await res.json().catch(() => ({}))
            toast.error(data.error || 'Failed to delete template')
          }
        } catch {
          toast.error('Failed to delete template')
        }
      },
    })
  }

  return (
    <div className="bg-white rounded-sm shadow-md p-6">
      {dialog}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold text-gray-900">
          Invoice Email Templates
        </h2>
        {!editing && (
          <button
            onClick={startNew}
            className="px-3 py-1.5 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors"
          >
            Add Template
          </button>
        )}
      </div>
      <p className="text-sm text-gray-500 mb-4">
        Reusable messages for &ldquo;Send by Email&rdquo; on invoices. The
        built-in default template is always available.
      </p>

      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Name
            </label>
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Friendly reminder"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Subject
            </label>
            <input
              type="text"
              value={editing.subject}
              onChange={(e) =>
                setEditing({ ...editing, subject: e.target.value })
              }
              placeholder="Leave blank to use the default subject"
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Message
            </label>
            <textarea
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {SHORTCODES.map(([code, hint]) => (
                <button
                  key={code}
                  type="button"
                  title={`Insert ${hint}`}
                  onClick={() =>
                    setEditing((prev) =>
                      prev ? { ...prev, body: `${prev.body}${code}` } : prev
                    )
                  }
                  className="bg-[#E6F1FB] text-[#0075DD] text-xs font-medium rounded-full px-2.5 py-1 hover:bg-[#D4E8F9]"
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditing(null)}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md disabled:opacity-50"
            >
              {saving ? 'Saving...' : isNew ? 'Create Template' : 'Save Template'}
            </button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          <div className="py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900">Default</p>
              <p className="text-xs text-gray-500">
                Built-in — adjusts automatically for overdue invoices.
              </p>
            </div>
            <span className="text-xs text-gray-400">Not editable</span>
          </div>
          {templates.map((t) => (
            <div key={t.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{t.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {t.body.replace(/\s+/g, ' ').slice(0, 90)}
                </p>
              </div>
              <div className="flex gap-3 flex-shrink-0">
                <button
                  onClick={() => {
                    setIsNew(false)
                    setEditing({ ...t })
                  }}
                  className="text-sm text-[#2FA84F] hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(t)}
                  className="text-sm text-red-600 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {templates.length === 0 && (
            <p className="py-3 text-sm text-gray-400">
              No custom templates yet.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
