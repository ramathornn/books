'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'

interface Props {
  invoiceId: string
  invoiceNumber: string
  currency: string
  amountDue: number
  onChanged?: () => void
  onDeleted?: (id: string) => void
}

function getCurrencySymbol(currency: string) {
  const map: Record<string, string> = { CAD: '$', USD: '$', EUR: '€', GBP: '£' }
  return map[currency.toUpperCase()] || '$'
}

export default function InvoiceRowActions({
  invoiceId,
  invoiceNumber,
  currency,
  amountDue,
  onChanged,
  onDeleted,
}: Props) {
  const router = useRouter()
  const { confirm, dialog } = useConfirm()
  const [menuOpen, setMenuOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0])
  const [paymentAmount, setPaymentAmount] = useState('0.00')
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer')
  const [paymentNotes, setPaymentNotes] = useState('')

  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  function stop(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function handleEdit(e: React.MouseEvent) {
    stop(e)
    router.push(`/invoices/${invoiceId}/edit`)
  }

  function handleDuplicate(e: React.MouseEvent) {
    stop(e)
    router.push(`/invoices/new?duplicate=${invoiceId}`)
  }

  function handlePayment(e: React.MouseEvent) {
    stop(e)
    setPaymentAmount(amountDue.toFixed(2))
    setPaymentDate(new Date().toISOString().split('T')[0])
    setPaymentMethod('Bank Transfer')
    setPaymentNotes('')
    setPaymentModalOpen(true)
  }

  async function handleSavePayment() {
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
        onChanged?.()
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Failed to add payment')
      }
    } catch {
      toast.error('Failed to add payment')
    } finally {
      setSubmitting(false)
    }
  }

  function handleMore(e: React.MouseEvent) {
    stop(e)
    setMenuOpen((o) => !o)
  }

  function handleDownloadPdf(e: React.MouseEvent) {
    stop(e)
    setMenuOpen(false)
    window.open(`/api/invoices/${invoiceId}/pdf`, '_blank')
  }

  function handleView(e: React.MouseEvent) {
    stop(e)
    setMenuOpen(false)
    router.push(`/invoices/${invoiceId}`)
  }

  function handleDelete(e: React.MouseEvent) {
    stop(e)
    setMenuOpen(false)
    confirm({
      title: 'Delete invoice',
      message: `Are you sure you want to delete Invoice #${invoiceNumber}? This action cannot be undone.`,
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        try {
          const res = await fetch(`/api/invoices/${invoiceId}`, { method: 'DELETE' })
          if (res.ok) {
            // Drop just this row from the list — no page refresh.
            onDeleted?.(invoiceId)
          } else {
            const data = await res.json().catch(() => ({}))
            toast.error(data.error || 'Failed to delete invoice')
          }
        } catch {
          toast.error('Failed to delete invoice')
        }
      },
    })
  }

  const btn =
    'w-8 h-8 flex items-center justify-center text-[#576981] hover:text-[#0075DD] hover:bg-[#F5F7FA] rounded-full transition-colors'

  const containerClass = `${menuOpen ? 'flex' : 'hidden group-hover:flex'} absolute -top-4 right-4 z-10 items-center gap-0.5 bg-white border border-[#E1E6EB] rounded-full shadow-md px-1 py-1`

  const currencySymbol = getCurrencySymbol(currency)

  return (
    <>
      {dialog}
      <div
        ref={containerRef}
        className={containerClass}
        onClick={stop}
        title={`Quick actions for #${invoiceNumber}`}
      >
        <button
          type="button"
          onClick={handleEdit}
          className={btn}
          aria-label="Edit invoice"
          title="Edit"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.7}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={handleDuplicate}
          className={btn}
          aria-label="Duplicate invoice"
          title="Duplicate"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.7}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={handlePayment}
          className={btn}
          aria-label="Add payment"
          title="Add payment"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth={1.7} />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.7}
              d="M14.5 9.5a2.5 2.5 0 00-5 0c0 1.5 1 2 2.5 2.5s2.5 1 2.5 2.5a2.5 2.5 0 01-5 0M12 7v1m0 8v1"
            />
          </svg>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={handleMore}
            className={btn}
            aria-label="More actions"
            title="More"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-[#E1E6EB] rounded-md shadow-lg py-1 z-50">
              <button
                type="button"
                onClick={handleView}
                className="w-full text-left px-3 py-2 text-sm text-[#001B40] hover:bg-[#F5F7FA]"
              >
                View invoice
              </button>
              <button
                type="button"
                onClick={handleDuplicate}
                className="w-full text-left px-3 py-2 text-sm text-[#001B40] hover:bg-[#F5F7FA]"
              >
                Duplicate invoice
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="w-full text-left px-3 py-2 text-sm text-[#001B40] hover:bg-[#F5F7FA]"
              >
                Download PDF
              </button>
              <div className="my-1 border-t border-[#E1E6EB]" />
              <button
                type="button"
                onClick={handleDelete}
                className="w-full text-left px-3 py-2 text-sm text-[#E53E3E] hover:bg-[#FFF5F5]"
              >
                Delete invoice
              </button>
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title={`Add a Payment to #${invoiceNumber}`}
      >
        <div className="space-y-4" onClick={stop}>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#2FA84F] focus:outline-none focus:ring-1 focus:ring-[#2FA84F]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount <span className="text-gray-400 font-normal">({currency})</span>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Internal Notes</label>
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
              type="button"
              onClick={() => setPaymentModalOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSavePayment}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md disabled:opacity-50 transition-colors"
            >
              {submitting ? 'Saving...' : 'Save Payment'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
