import Link from 'next/link'
import StatusBadge from './StatusBadge'

interface RecentCardProps {
  href: string
  title: string
  subtitle?: string
  amount?: string
  status?: string
  avatar?: { initials: string; color?: string }
}

export default function RecentCard({
  href,
  title,
  subtitle,
  amount,
  status,
  avatar,
}: RecentCardProps) {
  return (
    <Link
      href={href}
      className="w-[160px] flex-shrink-0 border border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors block"
    >
      {avatar ? (
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
            style={{ backgroundColor: avatar.color || '#0075DD' }}
          >
            {avatar.initials}
          </div>
          <div className="w-full truncate text-sm font-medium text-[#001B40]">{title}</div>
          {subtitle && (
            <div className="w-full truncate text-xs text-gray-500">{subtitle}</div>
          )}
          {amount && (
            <div className="w-full truncate text-sm font-semibold text-[#001B40]">{amount}</div>
          )}
          {status && <StatusBadge status={status} />}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <div className="truncate text-sm font-medium text-[#001B40]">{title}</div>
          {subtitle && <div className="truncate text-xs text-gray-500">{subtitle}</div>}
          {amount && (
            <div className="truncate text-sm font-semibold text-[#001B40]">{amount}</div>
          )}
          {status && (
            <div className="mt-1">
              <StatusBadge status={status} />
            </div>
          )}
        </div>
      )}
    </Link>
  )
}
