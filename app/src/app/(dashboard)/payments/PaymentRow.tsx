'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import StatusBadge from '@/components/ui/StatusBadge'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatCurrency } from '@/lib/utils'

interface Payment {
  id: string
  paymentDate: string // ISO
  paymentMethod: string | null
  amount: string // Decimal as string
  currency: string
  notes: string | null
  status: string
  invoiceId: string | null
  client: {
    firstName: string
    lastName: string
    organization: string
  }
  invoice: {
    id: string
    invoiceNumber: string
  } | null
}

interface Props {
  payment: Payment
  selected?: boolean
  onToggleSelected?: () => void
}

const PAYMENT_METHODS = [
  'Bank Transfer',
  'Cash',
  'Check',
  'Credit Card',
  'Interac E-Transfer',
  'PayPal',
  'Stripe',
  'Wire Transfer',
  'Other',
]

function formatDisplayDate(iso: string): string {
  const d = new Date(iso)
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const yyyy = d.getUTCFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function toInputDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export default function PaymentRow({ payment, selected, onToggleSelected }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rowRef = useRef<HTMLDivElement>(null)
  const { confirm, dialog } = useConfirm()

  // Form state
  const [paymentDate, setPaymentDate] = useState(toInputDate(payment.paymentDate))
  const [paymentMethod, setPaymentMethod] = useState(payment.paymentMethod || 'Bank Transfer')
  const [amount, setAmount] = useState(Number(payment.amount).toFixed(2))
  const [notes, setNotes] = useState(payment.notes || '')

  // Reset form when payment prop changes (after router.refresh)
  useEffect(() => {
    setPaymentDate(toInputDate(payment.paymentDate))
    setPaymentMethod(payment.paymentMethod || 'Bank Transfer')
    setAmount(Number(payment.amount).toFixed(2))
    setNotes(payment.notes || '')
  }, [payment])

  // Esc cancels editing
  useEffect(() => {
    if (!editing) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setEditing(false)
        setError('')
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [editing])

  const clientName = [payment.client.firstName, payment.client.lastName]
    .filter(Boolean)
    .join(' ')
  const displayName = payment.client.organization || clientName

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/payments/${payment.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: payment.invoiceId,
          paymentDate,
          paymentMethod,
          amount: parseFloat(amount),
          notes,
        }),
      })
      if (res.ok) {
        setEditing(false)
        router.refresh()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save payment.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function handleDelete() {
    confirm({
      title: 'Delete payment',
      message: 'Delete this payment? This will update the invoice balance.',
      variant: 'danger',
      confirmLabel: 'Delete',
      action: async () => {
        setSaving(true)
        setError('')
        try {
          const res = await fetch(`/api/payments/${payment.id}`, {
            method: 'DELETE',
          })
          if (res.ok) {
            router.refresh()
          } else {
            const data = await res.json().catch(() => ({}))
            setError(data.error || 'Failed to delete payment.')
            setSaving(false)
          }
        } catch {
          setError('Network error. Please try again.')
          setSaving(false)
        }
      },
    })
  }

  function handleCancel() {
    setPaymentDate(toInputDate(payment.paymentDate))
    setPaymentMethod(payment.paymentMethod || 'Bank Transfer')
    setAmount(Number(payment.amount).toFixed(2))
    setNotes(payment.notes || '')
    setError('')
    setEditing(false)
  }

  if (editing) {
    return (
      <div
        ref={rowRef}
        className="border-b border-gray-100 bg-[#F5FAFF] px-4 py-1"
      >
        {dialog}
        {/* Top row: identity + inline form */}
        <div className="grid grid-cols-1 sm:grid-cols-[40px_1fr_140px_170px_1fr_auto] gap-4 sm:items-center">
          <input
            type="checkbox"
            className="rounded border-gray-300"
            style={{ width: 20, height: 20 }}
            checked={!!selected}
            onChange={onToggleSelected}
            onClick={(e) => e.stopPropagation()}
          />
          {/* Identity (non-editable) */}
          <div>
            <div className="text-sm font-medium text-[#001B40]">{displayName}</div>
            {payment.invoice && (
              <div className="text-xs text-[#0075DD]">
                {payment.invoice.invoiceNumber}
              </div>
            )}
          </div>
          {/* Payment Date */}
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            disabled={saving}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#0075DD] focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
          {/* Payment Method */}
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            disabled={saving}
            className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#0075DD] focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {/* Amount */}
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={saving}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-right focus:border-[#0075DD] focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
            />
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {payment.currency}
            </span>
          </div>
          {/* Save / Cancel */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSave}
              disabled={saving}
              aria-label="Save"
              className="w-9 h-9 flex items-center justify-center rounded-md bg-[#038A06] hover:bg-[#026e05] text-white disabled:opacity-50"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              aria-label="Cancel"
              className="w-9 h-9 flex items-center justify-center rounded-md border border-gray-300 bg-white text-[#BF2600] hover:bg-gray-50 disabled:opacity-50"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Second row: notes + delete link */}
        <div className="mt-2 flex items-center gap-4">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes (Optional)"
            disabled={saving}
            className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-[#0075DD] focus:outline-none focus:ring-1 focus:ring-[#0075DD]"
          />
          <button
            onClick={handleDelete}
            disabled={saving}
            className="text-xs text-[#BF2600] hover:underline whitespace-nowrap disabled:opacity-50"
          >
            Delete Payment
          </button>
        </div>

        {error && (
          <div className="mt-2 text-xs text-[#BF2600]">{error}</div>
        )}
      </div>
    )
  }

  // Display mode
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setEditing(true)
        }
      }}
      className="table-row-hover sm:grid sm:grid-cols-[40px_1fr_140px_1fr_160px] sm:gap-4 sm:items-center flex items-start gap-3 px-4 py-1 border-b border-[#E1E6EB] cursor-pointer"
    >
      <div className="pt-0.5 sm:pt-0" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          className="rounded border-gray-300"
          style={{ width: 20, height: 20 }}
          checked={!!selected}
          onChange={onToggleSelected}
        />
      </div>
      {/* Mobile card layout */}
      <div className="sm:hidden flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium text-[#001B40] truncate">{displayName}</div>
            <div className="text-[13px] text-[#576981] mt-0.5">
              {payment.invoice ? (
                <Link
                  href={`/invoices/${payment.invoice.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[#0075DD] hover:underline"
                >
                  {payment.invoice.invoiceNumber}
                </Link>
              ) : (
                '-'
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[15px] font-medium text-[#001B40] whitespace-nowrap">
              {formatCurrency(Number(payment.amount), payment.currency, { includeCode: false })}{' '}
              <span className="text-[11px] text-[#576981]">{payment.currency}</span>
            </div>
            <div className="mt-1 flex justify-end">
              <StatusBadge status={payment.status} />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[12px] text-[#576981]">
          <span>{formatDisplayDate(payment.paymentDate)}</span>
          <span>{payment.paymentMethod || '-'}</span>
        </div>
        {payment.notes && (
          <div className="text-[12px] text-[#576981] truncate mt-1">{payment.notes}</div>
        )}
      </div>
      {/* Desktop columns */}
      <div className="hidden sm:block min-w-0">
        <div className="text-[16px] font-medium text-[#001B40] leading-tight truncate">
          {displayName}
        </div>
        <div className="text-[14px] text-[#576981] mt-0.5">
          {payment.invoice ? (
            <Link
              href={`/invoices/${payment.invoice.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-[#0075DD] hover:underline"
            >
              {payment.invoice.invoiceNumber}
            </Link>
          ) : (
            '-'
          )}
        </div>
      </div>
      <div className="hidden sm:block text-[14px] text-[#001B40]">
        {formatDisplayDate(payment.paymentDate)}
      </div>
      <div className="hidden sm:block min-w-0">
        <div className="text-[14px] text-[#001B40] truncate">
          {payment.paymentMethod || '-'}
        </div>
        {payment.notes && (
          <div className="text-[12px] text-[#576981] truncate mt-0.5">
            {payment.notes}
          </div>
        )}
      </div>
      <div className="hidden sm:block text-right">
        <div className="text-[16px] font-medium text-[#001B40]">
          {formatCurrency(Number(payment.amount), payment.currency, {
            includeCode: false,
          })}{' '}
          <span className="text-[12px] font-normal text-[#576981]">
            {payment.currency}
          </span>
        </div>
        <div className="mt-1 flex justify-end">
          <StatusBadge status={payment.status} />
        </div>
      </div>
    </div>
  )
}
