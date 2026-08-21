'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import AcceptPaymentsModal from '@/components/invoice/AcceptPaymentsModal'
import SendInvoiceEmailModal from '@/components/invoice/SendInvoiceEmailModal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

interface InvoiceActionsProps {
  invoiceId: string
  shareToken: string
  amountDue: number
  currency: string
  invoiceNumber: string
  status: string
  onlinePaymentsEnabled: boolean
  appBaseUrl: string
  clientEmail: string
  dateDue: string | null
  companyName: string
}

export default function InvoiceActions({
  invoiceId,
  shareToken: initialShareToken,
  amountDue,
  currency,
  invoiceNumber,
  status,
  onlinePaymentsEnabled,
  appBaseUrl,
  clientEmail,
  dateDue,
  companyName,
}: InvoiceActionsProps) {
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [draftShareConfirmOpen, setDraftShareConfirmOpen] = useState(false)
  const [markingSent, setMarkingSent] = useState(false)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [acceptPaymentsOpen, setAcceptPaymentsOpen] = useState(false)
  const [sendEmailOpen, setSendEmailOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [currentShareToken, setCurrentShareToken] = useState(initialShareToken)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { confirm, dialog } = useConfirm()

  // Payment form state
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [paymentAmount, setPaymentAmount] = useState(amountDue.toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer')
  const [paymentNotes, setPaymentNotes] = useState('')

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

  const shareUrl = `${appBaseUrl}/invoice/${currentShareToken}`

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
      const res = await fetch(`/api/invoices/${invoiceId}/regenerate-token`, {
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

  async function handleAddPayment() {
    setSubmitting(true)
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId,
          paymentDate,
          paymentMethod,
          amount: parseFloat(paymentAmount),
          notes: paymentNotes,
        }),
      })
      if (res.ok) {
        setPaymentModalOpen(false)
        setPaymentNotes('')
        router.refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to add payment')
      }
    } catch {
      toast.error('Failed to add payment')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMarkAsSent() {
    setDropdownOpen(false)
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent' }),
      })
      if (res.ok) {
        setCurrentStatus('sent')
        router.refresh()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to mark as sent')
      }
    } catch {
      toast.error('Failed to mark as sent')
    }
  }

  function handleArchive() {
    setDropdownOpen(false)
    confirm({
      title: 'Archive invoice',
      message: 'Are you sure you want to archive this invoice?',
      confirmLabel: 'Archive',
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${invoiceId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          })
          if (res.ok) {
            router.refresh()
          } else {
            const data = await res.json()
            toast.error(data.error || 'Failed to archive invoice')
          }
        } catch {
          toast.error('Failed to archive invoice')
        }
      },
    })
  }

  function handleWriteOff() {
    setDropdownOpen(false)
    confirm({
      title: 'Write off as bad debt',
      message: `Are you sure you want to write off Invoice ${invoiceNumber} as bad debt? This posts a journal entry (DR Bad Debt Expense / CR A/R) for the remaining balance and removes the invoice from A/R aging.`,
      variant: 'danger',
      confirmLabel: 'Write off',
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${invoiceId}/write-off`, {
            method: 'POST',
          })
          if (res.ok) {
            setCurrentStatus('bad_debt')
            router.refresh()
          } else {
            const data = await res.json().catch(() => ({}))
            toast.error(data.error || 'Failed to write off invoice')
          }
        } catch {
          toast.error('Failed to write off invoice')
        }
      },
    })
  }

  function handleMarkRefunded() {
    setDropdownOpen(false)
    confirm({
      title: 'Mark as refunded',
      message: `Mark Invoice ${invoiceNumber} as refunded? Its payments will be flagged as refunded and the invoice will no longer count as revenue collected. When the refund clears your bank, categorize that transaction to book the ledger entry.`,
      confirmLabel: 'Mark as Refunded',
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${invoiceId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'refunded' }),
          })
          if (res.ok) {
            setCurrentStatus('refunded')
            router.refresh()
          } else {
            const data = await res.json().catch(() => ({}))
            toast.error(data.error || 'Failed to mark as refunded')
          }
        } catch {
          toast.error('Failed to mark as refunded')
        }
      },
    })
  }

  function handleDuplicate() {
    setDropdownOpen(false)
    router.push(`/invoices/new?duplicate=${invoiceId}`)
  }

  function handlePrint() {
    setDropdownOpen(false)
    window.print()
  }

  function handleDownloadPdf() {
    setDropdownOpen(false)
    window.open(`/api/invoices/${invoiceId}/pdf`, '_blank')
  }

  function handleDelete() {
    setDropdownOpen(false)
    confirm({
      title: 'Delete invoice',
      message: `Are you sure you want to delete Invoice ${invoiceNumber}? This action cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${invoiceId}`, {
            method: 'DELETE',
          })
          if (res.ok) {
            router.push('/invoices')
          } else {
            const data = await res.json()
            toast.error(data.error || 'Failed to delete invoice')
          }
        } catch {
          toast.error('Failed to delete invoice')
        }
      },
    })
  }

  const currencySymbol = currency === 'EUR' ? '\u20ac' : currency === 'GBP' ? '\u00a3' : '$'

  return (
    <>
      {dialog}
      <button
        onClick={() => setSendEmailOpen(true)}
        className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors inline-flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Send by Email
      </button>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors inline-flex items-center gap-1"
        >
          More Actions
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
            <button
              onClick={() => {
                setDropdownOpen(false)
                setPaymentAmount(amountDue.toFixed(2))
                setPaymentDate(new Date().toISOString().split('T')[0])
                setPaymentMethod('Bank Transfer')
                setPaymentNotes('')
                setPaymentModalOpen(true)
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Add a Payment
            </button>
            <button
              onClick={() => {
                setDropdownOpen(false)
                setSendEmailOpen(true)
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Send by Email
            </button>
            <button
              onClick={() => {
                setDropdownOpen(false)
                setLinkCopied(false)
                if (currentStatus === 'draft') {
                  setDraftShareConfirmOpen(true)
                } else {
                  setShareModalOpen(true)
                }
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Share via Link
            </button>
            <button
              onClick={() => {
                setDropdownOpen(false)
                setAcceptPaymentsOpen(true)
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Accept Online Payments
              {onlinePaymentsEnabled && (
                <span className="ml-2 text-xs text-[#2FA84F]">(On)</span>
              )}
            </button>
            {(currentStatus === 'draft') && (
              <button
                onClick={handleMarkAsSent}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Mark as Sent
              </button>
            )}
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
            <button
              onClick={() => {
                setDropdownOpen(false)
                // Dispatch custom event to open the history drawer
                window.dispatchEvent(new CustomEvent('open-history-drawer'))
              }}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              View Audit Log
            </button>
            <div className="border-t border-gray-100 my-1" />
            {['paid', 'partial'].includes(currentStatus) && (
              <button
                onClick={handleMarkRefunded}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Mark as Refunded
              </button>
            )}
            {!['draft', 'paid', 'void', 'archived', 'bad_debt'].includes(currentStatus) &&
              amountDue > 0 && (
                <button
                  onClick={handleWriteOff}
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  Write off as bad debt
                </button>
              )}
            <button
              onClick={handleArchive}
              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Archive
            </button>
            <button
              onClick={handleDelete}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Add a Payment Modal (E12) */}
      <Modal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title="Add a Payment"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                {currencySymbol}
              </span>
              <input
                type="number"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full rounded-md border border-gray-300 pl-7 pr-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Method
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            >
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Cheque">Cheque</option>
              <option value="Cash">Cash</option>
              <option value="Credit Card">Credit Card</option>
              <option value="Interac E-Transfer">Interac E-Transfer</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Internal Notes
            </label>
            <textarea
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
              placeholder="Add notes about this payment..."
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setPaymentModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddPayment}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving...' : 'Save Payment'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={draftShareConfirmOpen}
        onClose={() => setDraftShareConfirmOpen(false)}
        title="Share via Link"
      >
        <div className="space-y-5">
          <p className="text-sm text-gray-700">
            Creating a shareable link will mark this draft Invoice as sent.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDraftShareConfirmOpen(false)}
              disabled={markingSent}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                setMarkingSent(true)
                try {
                  const res = await fetch(`/api/invoices/${invoiceId}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'sent' }),
                  })
                  if (res.ok) {
                    setCurrentStatus('sent')
                    setDraftShareConfirmOpen(false)
                    setShareModalOpen(true)
                    router.refresh()
                  } else {
                    const data = await res.json().catch(() => ({}))
                    toast.error(data.error || 'Failed to mark as sent')
                  }
                } catch {
                  toast.error('Failed to mark as sent')
                } finally {
                  setMarkingSent(false)
                }
              }}
              disabled={markingSent}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md disabled:opacity-50"
            >
              {markingSent ? 'Saving...' : 'Got it - Mark as Sent'}
            </button>
          </div>
        </div>
      </Modal>

      <SendInvoiceEmailModal
        isOpen={sendEmailOpen}
        onClose={() => setSendEmailOpen(false)}
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        clientEmail={clientEmail}
        amountDue={amountDue}
        currency={currency}
        dateDue={dateDue}
        isDraft={currentStatus === 'draft'}
        shareUrl={shareUrl}
        companyName={companyName}
        onSent={() => {
          if (currentStatus === 'draft') setCurrentStatus('sent')
          router.refresh()
        }}
      />

      <AcceptPaymentsModal
        isOpen={acceptPaymentsOpen}
        onClose={() => setAcceptPaymentsOpen(false)}
        invoiceId={invoiceId}
        initialEnabled={onlinePaymentsEnabled}
      />

      {/* Share via Link Modal (E13) */}
      <Modal
        isOpen={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title="Share via Link"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this link with your client so they can view the invoice and make a payment.
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
