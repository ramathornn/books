type Status =
  | 'paid'
  | 'overdue'
  | 'viewed'
  | 'sent'
  | 'draft'
  | 'partial'
  | 'accepted'
  | 'invoiced'
  | 'declined'
  | 'refunded'

const statusLabels: Record<Status, string> = {
  paid: 'Paid',
  overdue: 'Overdue',
  viewed: 'Viewed',
  sent: 'Sent',
  draft: 'Draft',
  partial: 'Partial',
  accepted: 'Accepted',
  invoiced: 'Invoiced',
  declined: 'Declined',
  refunded: 'Refunded',
}

const statusColors: Record<Status, { bg: string; text: string }> = {
  draft: { bg: '#E8E8E8', text: '#666666' },
  sent: { bg: '#E3F0FF', text: '#0075DD' },
  viewed: { bg: '#FFF3CC', text: '#7A5C00' },
  accepted: { bg: '#E3F0FF', text: '#0075DD' },
  invoiced: { bg: '#D4EDDA', text: '#155724' },
  paid: { bg: '#D4EDDA', text: '#155724' },
  overdue: { bg: '#FDECEA', text: '#BF2600' },
  partial: { bg: '#FFF0E6', text: '#8B4513' },
  declined: { bg: '#FDECEA', text: '#BF2600' },
  refunded: { bg: '#F3E8FF', text: '#6B21A8' },
}

function toTitleCase(s: string) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export default function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase() as Status
  const colors = statusColors[s] || { bg: '#E8E8E8', text: '#666666' }
  const label = statusLabels[s] || toTitleCase(status)

  return (
    <span
      className="inline-flex items-center rounded text-[11px] font-medium px-2 py-0"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {label}
    </span>
  )
}
