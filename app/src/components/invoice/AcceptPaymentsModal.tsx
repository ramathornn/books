'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { toast } from '@/lib/toast'

interface Props {
  isOpen: boolean
  onClose: () => void
  invoiceId: string
  initialEnabled: boolean
}

export default function AcceptPaymentsModal({
  isOpen,
  onClose,
  invoiceId,
  initialEnabled,
}: Props) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saveAsDefault, setSaveAsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/online-payments`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          saveAsDefault,
        }),
      })
      if (res.ok) {
        onClose()
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Accept Online Payments">
      <div className="space-y-5">
        <p className="text-sm text-gray-600">
          Let your client pay this invoice by credit card.
        </p>

        <div className="flex items-center justify-between border-t border-gray-200 pt-5">
          <span className="text-sm font-medium text-gray-900">
            Turn on/off online payments
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              enabled ? 'bg-[#2FA84F]' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <div className="text-sm font-medium text-gray-900 mb-2">Payment methods</div>
          <div className={`text-sm ${enabled ? 'text-gray-700' : 'text-gray-400'}`}>
            Credit and Debit Cards
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs font-bold text-[#1A1F71] bg-white border border-gray-200 rounded px-1.5 py-0.5">VISA</span>
            <span className="text-xs font-bold text-[#EB001B] bg-white border border-gray-200 rounded px-1.5 py-0.5">MC</span>
            <span className="text-xs font-bold text-[#1F72CD] bg-white border border-gray-200 rounded px-1.5 py-0.5">AMEX</span>
          </div>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300"
            />
            <span className="text-sm text-gray-700">
              Use these settings for all future invoices
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Done'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
