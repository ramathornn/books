'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from '@/lib/toast'

interface Props {
  clientId: string
  clientName: string
}

export default function ClientDetailHeader({ clientId, clientName }: Props) {
  const router = useRouter()
  const [moreOpen, setMoreOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const createRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
      if (createRef.current && !createRef.current.contains(e.target as Node)) {
        setCreateOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        router.push('/clients')
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete client')
      }
    } catch {
      toast.error('Failed to delete client')
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <>
      {/* More Actions dropdown */}
      <div className="relative" ref={moreRef}>
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors inline-flex items-center gap-1"
        >
          More Actions
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {moreOpen && (
          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            <button
              onClick={() => {
                setMoreOpen(false)
                toast.info('Archive functionality not yet implemented')
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Archive Client
            </button>
            <button
              onClick={() => {
                setMoreOpen(false)
                setShowDeleteConfirm(true)
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Delete Client
            </button>
          </div>
        )}
      </div>

      {/* Create New dropdown */}
      <div className="relative" ref={createRef}>
        <button
          onClick={() => setCreateOpen(!createOpen)}
          className="px-4 py-2 bg-[#2FA84F] hover:bg-[#268f3e] text-white text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1"
        >
          Create New...
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {createOpen && (
          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            <Link
              href={`/invoices/new?clientId=${clientId}`}
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setCreateOpen(false)}
            >
              New Invoice for Client
            </Link>
            <Link
              href={`/estimates/new?clientId=${clientId}`}
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setCreateOpen(false)}
            >
              New Estimate for Client
            </Link>
            <Link
              href={`/invoices/new?clientId=${clientId}&addPayment=true`}
              className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setCreateOpen(false)}
            >
              Add Payment for Client
            </Link>
          </div>
        )}
      </div>

      {/* I7: Soft-delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Client</h3>
            <p className="text-sm text-gray-600 mb-6">
              Are you sure you want to delete <strong>{clientName}</strong>? This action cannot be undone.
              Clients with existing invoices or estimates cannot be deleted.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
