'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'

interface SplitLine {
  accountNumber: string
  accountName: string
  amount: number
}

interface Props {
  lines: SplitLine[]
  currency: string
}

export default function SplitTooltip({ lines, currency }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-block cursor-help"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="text-[#0075DD] underline decoration-dotted underline-offset-2">-Split-</span>
      {open && (
        <span className="absolute z-30 left-0 top-full mt-1 bg-white border border-[#E1E6EB] rounded-md shadow-lg p-3 w-[320px] text-xs">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5">
            <div className="font-semibold text-[#001B40] pb-1 border-b border-[#E1E6EB]">Account</div>
            <div className="font-semibold text-[#001B40] pb-1 border-b border-[#E1E6EB] text-right">Amount</div>
            {lines.map((l, i) => (
              <span key={i} className="contents">
                <span className="text-[#0075DD] truncate">
                  {l.accountNumber} {l.accountName}
                </span>
                <span className={`font-mono text-right ${l.amount < 0 ? 'text-[#BF2600]' : 'text-[#001B40]'}`}>
                  {formatCurrency(l.amount, currency, { includeCode: false })}
                </span>
              </span>
            ))}
          </div>
        </span>
      )}
    </span>
  )
}
