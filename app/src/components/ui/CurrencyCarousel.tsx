'use client'

import { useState, useEffect } from 'react'

interface CurrencyAmount {
  currency: string
  amount: number
}

interface CurrencyCarouselProps {
  items: CurrencyAmount[]
  colorClass?: string
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
  return `${prefix}${symbol}${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${currency}`
}

export default function CurrencyCarousel({ items, colorClass }: CurrencyCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0)

  // Filter to non-zero items
  const nonZero = items.filter((i) => i.amount !== 0)

  // D4: ~2.5s per currency
  useEffect(() => {
    if (nonZero.length <= 1) return
    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % nonZero.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [nonZero.length])

  if (nonZero.length === 0) {
    return <span className={colorClass}>$0</span>
  }

  return (
    <span className="relative inline-block min-w-[80px]">
      {nonZero.map((item, i) => (
        <span
          key={item.currency}
          className={`transition-opacity duration-500 ${colorClass || ''} ${
            i === activeIndex % nonZero.length ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
        >
          {abbreviateAmount(item.amount, item.currency)}
        </span>
      ))}
    </span>
  )
}
