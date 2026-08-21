import Link from 'next/link'

interface Props {
  href: string
  number: string
  clientName: string
  date: string
  amount: string
  status: string
}

export default function RecentDocCard({
  href,
  number,
  clientName,
  date,
  amount,
  status,
}: Props) {
  return (
    <Link href={href} className="block group">
      <div
        className="rounded-md overflow-hidden flex flex-col bg-white"
        style={{
          boxShadow:
            '0 1px 2px rgba(0, 27, 64, 0.06), 0 0 0 1px rgba(0, 27, 64, 0.06)',
        }}
      >
        <div className="px-3 pt-4 pb-3 flex flex-col min-h-[170px] sm:min-h-[225px]">
          <div className="text-[11px] text-[#8C9BAB]">{number}</div>
          <div className="text-[13px] text-[#001B40] truncate w-full mt-0.5">
            {clientName}
          </div>
          <div className="text-[11px] text-[#576981] mt-0.5">{date}</div>
          <div className="mt-auto pt-3 border-t border-[#E1E6EB] text-right text-[18px] font-semibold text-[#001B40]">
            {amount}
          </div>
        </div>
        <StatusFooter status={status} />
      </div>
    </Link>
  )
}

function statusFooterColor(s: string) {
  const v = s.toLowerCase()
  if (v === 'paid' || v === 'accepted' || v === 'invoiced')
    return { bg: '#E6F4EA', text: '#1F7A3A' }
  if (v === 'viewed') return { bg: '#FEF4E1', text: '#A7740C' }
  if (v === 'overdue' || v === 'declined')
    return { bg: '#FDECEF', text: '#C93E57' }
  if (v === 'sent') return { bg: '#E6F4FF', text: '#0075DD' }
  return { bg: '#F0F2F5', text: '#576981' } // draft/default
}

function statusLabel(s: string) {
  const v = s.toLowerCase()
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function StatusFooter({ status }: { status: string }) {
  const c = statusFooterColor(status)
  return (
    <div
      className="text-center text-[12px] py-1.5 font-medium border-t border-[#E1E6EB]"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      {statusLabel(status)}
    </div>
  )
}
