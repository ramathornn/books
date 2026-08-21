'use client'

import { useState } from 'react'
import Modal from './Modal'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  message: string | React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger'
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)

  async function handleConfirm() {
    if (pending) return
    try {
      setPending(true)
      await onConfirm()
    } finally {
      setPending(false)
    }
  }

  function handleCancel() {
    if (pending) return
    onCancel()
  }

  const confirmClasses =
    variant === 'danger'
      ? 'bg-[#BF2600] hover:bg-[#a01f00]'
      : 'bg-[#2FA84F] hover:bg-[#268f3e]'

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} title={title}>
      <div className="text-sm text-[#001B40] leading-relaxed">{message}</div>
      <div className="mt-6 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending}
          className="px-4 py-2 rounded border border-[#E1E6EB] text-sm font-medium text-[#001B40] hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className={`px-4 py-2 rounded text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${confirmClasses}`}
        >
          {pending ? 'Working...' : confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export interface ConfirmState {
  title: string
  message: string | React.ReactNode
  variant?: 'default' | 'danger'
  confirmLabel?: string
  cancelLabel?: string
  action: () => void | Promise<void>
}

export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null)

  function confirm(opts: ConfirmState): void {
    setState(opts)
  }

  const dialog = state ? (
    <ConfirmDialog
      isOpen={true}
      title={state.title}
      message={state.message}
      variant={state.variant}
      confirmLabel={state.confirmLabel}
      cancelLabel={state.cancelLabel}
      onConfirm={async () => {
        await state.action()
        setState(null)
      }}
      onCancel={() => setState(null)}
    />
  ) : null

  return { confirm, dialog }
}
