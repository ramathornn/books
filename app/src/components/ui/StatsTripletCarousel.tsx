'use client'

import { useEffect, useState } from 'react'

interface TripletStats {
  overdueByC: { currency: string; amount: number }[]
  outstandingByC: { currency: string; amount: number }[]
  draftByC: { currency: string; amount: number }[]
}

function abbreviateAmount(amount: number, currency: string): string {
  const symbolMap: Record<string, string> = {
    CAD: '$',
    USD: '$',
    EUR: '\u20ac',
    GBP: '\u00a3',
  }
  const symbol = symbolMap[currency.toUpperCase()] || '$'
  const abs = Math.abs(amount)
  const prefix = amount < 0 ? '-' : ''

  if (abs >= 1_000_000) {
    const val = abs / 1_000_000
    return `${prefix}${symbol}${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}M ${currency}`
  }
  if (abs >= 1_000) {
    const val = abs / 1_000
    return `${prefix}${symbol}${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)}k ${currency}`
  }
  return `${prefix}${symbol}${abs.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} ${currency}`
}

// Tile height — kept stable so the carousel window stays the same size
function Tile({
  value,
  label,
}: {
  value: string
  label: string
}) {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-3 sm:p-4">
      <div className="text-[18px] sm:text-[28px] font-bold text-[#0075DD] leading-none break-words">
        {value}
      </div>
      <div className="text-[11px] sm:text-[13px] text-[#576981] mt-2">{label}</div>
    </div>
  )
}

export default function StatsTripletCarousel({
  overdueByC,
  outstandingByC,
  draftByC,
}: TripletStats) {
  // Build the list of currencies present in any of the three metrics
  const currencies = Array.from(
    new Set([
      ...overdueByC.map((i) => i.currency),
      ...outstandingByC.map((i) => i.currency),
      ...draftByC.map((i) => i.currency),
    ])
  )

  const [index, setIndex] = useState(0)
  const [anim, setAnim] = useState<'in' | 'out'>('in')

  useEffect(() => {
    if (currencies.length <= 1) return
    const DWELL_MS = 5500
    const ANIM_MS = 450

    let timeout: ReturnType<typeof setTimeout>
    const cycle = () => {
      setAnim('out')
      timeout = setTimeout(() => {
        setIndex((p) => (p + 1) % currencies.length)
        setAnim('in')
      }, ANIM_MS)
    }
    const interval = setInterval(cycle, DWELL_MS + ANIM_MS)
    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [currencies.length])

  const pick = (list: { currency: string; amount: number }[]) => {
    const currency = currencies[index] || 'CAD'
    const entry = list.find((i) => i.currency === currency)
    return abbreviateAmount(entry?.amount || 0, currency)
  }

  const animClass =
    anim === 'in'
      ? 'opacity-100 translate-y-0'
      : 'opacity-0 -translate-y-3'

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-6">
      <div
        className={`transition-all duration-[450ms] ease-out ${animClass}`}
      >
        <Tile value={pick(overdueByC)} label="overdue" />
      </div>
      <div
        className={`transition-all duration-[450ms] ease-out ${animClass}`}
      >
        <Tile value={pick(outstandingByC)} label="total outstanding" />
      </div>
      <div
        className={`transition-all duration-[450ms] ease-out ${animClass}`}
      >
        <Tile value={pick(draftByC)} label="in draft" />
      </div>
    </div>
  )
}
