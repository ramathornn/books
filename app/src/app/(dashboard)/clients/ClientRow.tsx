'use client'

import { useRouter } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

interface Props {
  client: {
    id: string
    firstName: string
    lastName: string
    organization: string
    internalNote: string
    currency: string
    outstandingByCurrency: Record<string, number>
  }
}

export default function ClientRow({ client }: Props) {
  const router = useRouter()

  const outstandingEntries = Object.entries(client.outstandingByCurrency).filter(
    ([, amt]) => amt > 0
  )
  const totalOutstanding = outstandingEntries.reduce((s, [, v]) => s + v, 0)
  const outstandingCurrency =
    outstandingEntries[0]?.[0] || client.currency || 'CAD'

  const displayName =
    client.organization || `${client.firstName} ${client.lastName}`.trim()

  function handleRowClick() {
    router.push(`/clients/${client.id}`)
  }

  return (
    <tr
      role="link"
      tabIndex={0}
      onClick={handleRowClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          router.push(`/clients/${client.id}`)
        }
      }}
      className="table-row-hover cursor-pointer"
    >
      <td
        className="px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          className="rounded border-gray-300"
          aria-label={`Select ${displayName}`}
        />
      </td>
      <td className="px-4 py-1">
        <div className="text-sm font-semibold text-[#001B40]">
          {displayName}
        </div>
        {client.organization && (client.firstName || client.lastName) && (
          <div className="text-xs text-[#576981]">
            {`${client.firstName} ${client.lastName}`.trim()}
          </div>
        )}
      </td>
      <td className="px-4 py-1 text-sm text-[#576981] truncate max-w-[280px]">
        {client.internalNote || ''}
      </td>
      <td className="px-4 py-1 text-sm text-[#576981] text-right">
        {/* Credit — not tracked in this schema, leave blank per FB pattern */}
      </td>
      <td className="px-4 py-1 text-sm text-right">
        <div className="inline-flex items-center justify-end gap-3">
          <div
            className="row-actions inline-flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              title="Edit"
              onClick={() => router.push(`/clients/${client.id}/edit`)}
              className="text-[#576981] hover:text-[#0075DD]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              type="button"
              title="Archive"
              className="text-[#576981] hover:text-[#0075DD]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 8h14M5 8a2 2 0 01-2-2V5a2 2 0 012-2h14a2 2 0 012 2v1a2 2 0 01-2 2M5 8v11a2 2 0 002 2h10a2 2 0 002-2V8M10 12h4" />
              </svg>
            </button>
            <button
              type="button"
              title="Delete"
              className="text-[#576981] hover:text-[#C93E57]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
          </div>
          <span>
            <span className="text-[#0075DD]">
              {formatCurrency(totalOutstanding, outstandingCurrency, {
                includeCode: false,
              })}
            </span>{' '}
            <span className="text-xs text-[#576981]">{outstandingCurrency}</span>
          </span>
        </div>
      </td>
    </tr>
  )
}
