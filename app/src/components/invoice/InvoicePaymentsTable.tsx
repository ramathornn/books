'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Modal from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { toast } from '@/lib/toast'

interface PaymentData {
  id: string
  paymentDate: string
  paymentMethod: string | null
  notes: string | null
  amount: number
}

interface InvoicePaymentsTableProps {
  payments: PaymentData[]
  invoiceNumber: string
  invoiceId: string
  currency: string
  amountDue: number
  status: string
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const year = d.getUTCFullYear()
  return `${month}/${day}/${year}`
}

function getCurrencySymbol(currency: string) {
  const map: Record<string, string> = { CAD: '$', USD: '$', EUR: '\u20ac', GBP: '\u00a3' }
  return map[currency.toUpperCase()] || '$'
}

function fmtMoney(amount: number, currency: string) {
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(amount)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const prefix = amount < 0 ? '-' : ''
  return `${prefix}${symbol}${formatted}`
}

export default function InvoicePaymentsTable({
  payments,
  invoiceNumber,
  invoiceId,
  currency,
  amountDue,
}: InvoicePaymentsTableProps) {
  const router = useRouter()
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentAmount, setPaymentAmount] = useState(amountDue.toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState('Bank Transfer')
  const [paymentNotes, setPaymentNotes] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { confirm, dialog } = useConfirm()

  function handleDeletePayment(paymentId: string) {
    confirm({
      title: 'Delete payment',
      message: 'Delete this payment? This will update the invoice amount due.',
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        setDeletingId(paymentId)
        try {
          const res = await fetch(`/api/payments/${paymentId}`, { method: 'DELETE' })
          if (res.ok) {
            router.refresh()
          } else {
            const data = await res.json()
            toast.error(data.error || 'Failed to delete payment')
          }
        } catch {
          toast.error('Failed to delete payment')
        } finally {
          setDeletingId(null)
        }
      },
    })
  }

  const currencySymbol = getCurrencySymbol(currency)

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

  return (
    <div className="mt-6 print:hidden">
      {dialog}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          All Payments For Invoice {invoiceNumber}
        </h2>
        <button
          onClick={() => {
            setPaymentAmount(amountDue.toFixed(2))
            setPaymentDate(new Date().toISOString().split('T')[0])
            setPaymentMethod('Bank Transfer')
            setPaymentNotes('')
            setPaymentModalOpen(true)
          }}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-[#2FA84F] hover:bg-[#268f3e] rounded-md transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Payment
        </button>
      </div>

      {payments.length > 0 ? (
        <div className="bg-white rounded-sm shadow-sm border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 tracking-wider">
                  Date
                </th>
                <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 tracking-wider">
                  Payment Method / Internal Notes
                </th>
                <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 tracking-wider">
                  Line Total
                </th>
                <th className="px-3 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-b border-gray-100 group">
                  <td className="px-5 py-3 text-sm text-gray-900">
                    {formatDate(payment.paymentDate)}
                  </td>
                  <td className="px-5 py-3 text-sm align-top">
                    <div className="text-gray-900">{payment.paymentMethod || 'Payment'}</div>
                    {payment.notes && (
                      <div className="text-xs text-gray-500 mt-0.5">{payment.notes}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm font-medium text-gray-900 text-right">
                    {fmtMoney(payment.amount, currency)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleDeletePayment(payment.id)}
                      disabled={deletingId === payment.id}
                      className="text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
                      title="Delete payment"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-sm shadow-sm border border-gray-200 px-5 py-8 text-center text-sm text-gray-500">
          No payments recorded yet.
        </div>
      )}

      {/* Payment modal from payments table */}
      <Modal
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title="Add a Payment"
      >
        <div className="space-y-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
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
    </div>
  )
}
