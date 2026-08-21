'use client'

import { useState, useEffect } from 'react'

interface Activity {
  id: string
  type: string
  description: string
  amount: number | null
  createdAt: string
}

interface ViewHistoryDrawerProps {
  invoiceId: string
}

function getActivityIcon(type: string) {
  switch (type) {
    case 'created':
      return (
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      )
    case 'sent':
      return (
        <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    case 'viewed':
      return (
        <svg className="w-4 h-4 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      )
    case 'emailed':
      return (
        <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      )
    case 'payment_added':
      return (
        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    default:
      return (
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
  }
}

export default function ViewHistoryDrawer({ invoiceId }: ViewHistoryDrawerProps) {
  const [open, setOpen] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setLoading(true)
      fetch(`/api/invoices/${invoiceId}/activities`)
        .then((r) => r.json())
        .then((data) => {
          setActivities(data.data || [])
        })
        .catch(() => {
          setActivities([])
        })
        .finally(() => setLoading(false))
    }
  }, [open, invoiceId])

  // Close on escape
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) setOpen(false)
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [open])

  // Listen for custom event from More Actions dropdown (View Audit Log)
  useEffect(() => {
    function handleOpenDrawer() {
      setOpen(true)
    }
    window.addEventListener('open-history-drawer', handleOpenDrawer)
    return () => window.removeEventListener('open-history-drawer', handleOpenDrawer)
  }, [])

  function formatActivityDate(dateStr: string) {
    const d = new Date(dateStr)
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }
    return d.toLocaleDateString('en-US', options)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center text-sm font-medium hover:underline"
      >
        View History
      </button>

      {/* Overlay - dims page behind drawer */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Right-side drawer (E9) */}
      <div
        className={`fixed top-0 right-0 h-full w-96 bg-white shadow-xl z-50 transform transition-transform duration-300 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">History</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="px-6 py-4 overflow-y-auto h-[calc(100%-64px)]">
          {loading ? (
            <div className="text-sm text-gray-500 text-center py-8">Loading...</div>
          ) : activities.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-8">No history found.</div>
          ) : (
            <div className="space-y-0">
              {activities.map((activity, index) => (
                <div key={activity.id} className="relative flex gap-3 pb-6">
                  {/* Timeline line */}
                  {index < activities.length - 1 && (
                    <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-gray-200" />
                  )}
                  {/* Icon */}
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center relative z-10">
                    {getActivityIcon(activity.type)}
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-900">{activity.description}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {formatActivityDate(activity.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
