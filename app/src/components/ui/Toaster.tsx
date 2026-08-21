'use client'

import { useEffect, useState } from 'react'
import { subscribeToasts, type ToastMessage } from '@/lib/toast'

interface ActiveToast extends ToastMessage {
  exiting?: boolean
}

const AUTO_DISMISS_MS: Record<ToastMessage['type'], number> = {
  success: 4000,
  info: 4000,
  error: 6000,
}

const BORDER_COLOR: Record<ToastMessage['type'], string> = {
  success: '#2FA84F',
  info: '#0075DD',
  error: '#BF2600',
}

export default function Toaster() {
  const [toasts, setToasts] = useState<ActiveToast[]>([])

  useEffect(() => {
    const unsubscribe = subscribeToasts((toast) => {
      setToasts((prev) => [...prev, toast])
      const duration = AUTO_DISMISS_MS[toast.type]
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id))
      }, duration)
    })
    return unsubscribe
  }, [])

  function dismiss(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 bg-white rounded-md shadow-lg border border-[#E1E6EB] px-4 py-3"
          style={{ borderLeft: `4px solid ${BORDER_COLOR[t.type]}` }}
          role={t.type === 'error' ? 'alert' : 'status'}
        >
          <div className="flex-1 text-sm text-[#001B40] leading-snug break-words">
            {t.message}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="text-[#576981] hover:text-[#001B40] transition-colors flex-shrink-0"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  )
}
