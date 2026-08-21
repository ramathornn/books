'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

interface EstimateActionsProps {
  estimateId: string
  shareToken: string
  status: string
  linkedInvoiceId?: string | null
}

export default function EstimateActions({
  estimateId,
  shareToken: initialShareToken,
  status,
  linkedInvoiceId,
}: EstimateActionsProps) {
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [currentShareToken, setCurrentShareToken] = useState(initialShareToken)
  const [converting, setConverting] = useState(false)
  const [updating, setUpdating] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { confirm, dialog } = useConfirm()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Build share URL from the current browser origin so it works in any environment
  const [origin, setOrigin] = useState('')
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin)
    }
  }, [])
  const shareUrl = `${origin}/estimate/${currentShareToken}`

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = shareUrl
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  async function handleRegenerateLink() {
    try {
      const res = await fetch(`/api/estimates/${estimateId}/regenerate-token`, {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        setCurrentShareToken(data.shareToken)
        setLinkCopied(false)
      }
    } catch {
      // ignore
    }
  }

  async function handleMarkAs(newStatus: string) {
    setDropdownOpen(false)
    setUpdating(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) {
        router.refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || `Failed to mark as ${newStatus}`)
      }
    } catch {
      toast.error(`Failed to mark as ${newStatus}`)
    } finally {
      setUpdating(false)
    }
  }

  async function handleConvertToInvoice() {
    setDropdownOpen(false)
    setConverting(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (res.ok) {
        const invoice = await res.json()
        router.push(`/invoices/${invoice.id}`)
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to convert to invoice')
      }
    } catch {
      toast.error('Failed to convert to invoice')
    } finally {
      setConverting(false)
    }
  }

  function handleViewInvoice() {
    setDropdownOpen(false)
    if (linkedInvoiceId) {
      router.push(`/invoices/${linkedInvoiceId}`)
    }
  }

  function handleDuplicate() {
    setDropdownOpen(false)
    router.push(`/estimates/new?duplicate=${estimateId}`)
  }

  function handlePrint() {
    setDropdownOpen(false)
    window.print()
  }

  function handleDownloadPdf() {
    setDropdownOpen(false)
    window.open(`/api/estimates/${estimateId}/pdf`, '_blank')
  }

  function handleArchive() {
    setDropdownOpen(false)
    confirm({
      title: 'Archive estimate',
      message: 'Are you sure you want to archive this estimate?',
      confirmLabel: 'Archive',
      action: async () => {
        try {
          const res = await fetch(`/api/estimates/${estimateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          })
          if (res.ok) {
            router.push('/estimates')
          } else {
            const data = await res.json()
            toast.error(data.error || 'Failed to archive estimate')
          }
        } catch {
          toast.error('Failed to archive estimate')
        }
      },
    })
  }

  function handleDelete() {
    setDropdownOpen(false)
    confirm({
      title: 'Delete estimate',
      message: 'Are you sure you want to delete this estimate? This action cannot be undone.',
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        try {
          const res = await fetch(`/api/estimates/${estimateId}`, {
            method: 'DELETE',
          })
          if (res.ok) {
            router.push('/estimates')
          } else {
            const data = await res.json()
            toast.error(data.error || 'Failed to delete estimate')
          }
        } catch {
          toast.error('Failed to delete estimate')
        }
      },
    })
  }

  // G9: Status-dependent menu items
  const isDraftSentViewed = ['draft', 'sent', 'viewed'].includes(status)
  const isAccepted = status === 'accepted'
  const isInvoiced = status === 'invoiced'

  return (
    <>
      {dialog}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          disabled={converting || updating}
          className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#001B40] rounded-md hover:bg-gray-50 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
        >
          {converting ? 'Converting...' : updating ? 'Updating...' : 'More Actions'}
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>
        {dropdownOpen && (
          <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            {/* Share via Link — always shown — opens modal */}
            <button
              onClick={() => {
                setDropdownOpen(false)
                setLinkCopied(false)
                setShareModalOpen(true)
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Share via Link
            </button>

            {/* Draft/Sent/Viewed: Mark as Accepted, Mark as Declined */}
            {isDraftSentViewed && (
              <>
                <button
                  onClick={() => handleMarkAs('accepted')}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Mark as Accepted
                </button>
                <button
                  onClick={() => handleMarkAs('declined')}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  Mark as Declined
                </button>
              </>
            )}

            {/* Accepted: Convert to Invoice */}
            {isAccepted && (
              <button
                onClick={handleConvertToInvoice}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Convert to Invoice
              </button>
            )}

            {/* Invoiced: View Invoice */}
            {isInvoiced && linkedInvoiceId && (
              <button
                onClick={handleViewInvoice}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                View Invoice
              </button>
            )}

            {/* Always shown: Duplicate, Print, Download PDF */}
            <button
              onClick={handleDuplicate}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Duplicate
            </button>
            <button
              onClick={handlePrint}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Print
            </button>
            <button
              onClick={handleDownloadPdf}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Download PDF
            </button>

            <div className="border-t border-gray-100 my-1" />

            {/* Archive */}
            <button
              onClick={handleArchive}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Archive
            </button>

            {/* Delete */}
            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Share via Link Modal */}
      <Modal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title="Share via Link"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this link with your client so they can view the estimate and accept or decline it.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={shareUrl}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm bg-gray-50 text-gray-700 select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={handleCopyLink}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors whitespace-nowrap"
            >
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          <button
            onClick={handleRegenerateLink}
            className="text-sm text-[#2FA84F] hover:underline"
          >
            Regenerate Link
          </button>
          <p className="text-xs text-gray-400">
            Regenerating the link will invalidate the previous link.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShareModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => setShareModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
