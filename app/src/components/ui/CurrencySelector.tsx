'use client'

interface CurrencySelectorProps {
  selected: string
  onChange: (currency: string) => void
  currencies?: string[]
}

export default function CurrencySelector({
  selected,
  onChange,
  currencies = ['CAD', 'USD', 'EUR'],
}: CurrencySelectorProps) {
  return (
    <div className="inline-flex rounded-md border border-gray-300 overflow-hidden">
      {currencies.map((currency) => (
        <button
          key={currency}
          onClick={() => onChange(currency)}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            selected === currency
              ? 'bg-[#1A3353] text-white'
              : 'bg-white text-gray-600 hover:bg-gray-50'
          }`}
        >
          {currency}
        </button>
      ))}
    </div>
  )
}
