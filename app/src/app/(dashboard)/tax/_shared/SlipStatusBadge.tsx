/**
 * Slip lifecycle status badge, shared across T5/T4A lists and detail pages.
 * Colours mirror the app's status palette (draft amber, issued blue, filed
 * green, amended/cancelled muted/red).
 */
const STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: '#FFF8E8', fg: '#8A6D1B', label: 'Draft' },
  issued: { bg: '#EAF3FE', fg: '#0063BD', label: 'Issued' },
  filed: { bg: '#F0FBF3', fg: '#256A3A', label: 'Filed' },
  amended: { bg: '#F4F7FB', fg: '#576981', label: 'Superseded' },
  cancelled: { bg: '#FFF1F1', fg: '#9B2C2C', label: 'Cancelled' },
}

export default function SlipStatusBadge({
  status,
  reportCode,
}: {
  status: string
  reportCode?: string
}) {
  const s = STYLES[status] ?? { bg: '#F4F7FB', fg: '#576981', label: status }
  // Surface the report code for amendments / cancellations.
  const suffix = reportCode === 'A' ? ' · A' : reportCode === 'C' ? ' · C' : ''
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      {s.label}
      {suffix}
    </span>
  )
}
