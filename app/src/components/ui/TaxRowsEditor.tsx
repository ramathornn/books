'use client'

import { ItemTax } from '@/lib/taxes'

interface Props {
  taxes: ItemTax[]
  onChange: (taxes: ItemTax[]) => void
}

export default function TaxRowsEditor({ taxes, onChange }: Props) {
  function update(i: number, patch: Partial<ItemTax>) {
    onChange(taxes.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }
  function remove(i: number) {
    onChange(taxes.filter((_, idx) => idx !== i))
  }
  function add() {
    onChange([
      ...taxes,
      { name: '', rate: 0, number: '', enabled: true },
    ])
  }

  return (
    <div>
      <div className="text-sm font-semibold text-[#001B40] mb-3">Taxes</div>
      {taxes.length > 0 && (
        <div className="grid grid-cols-[24px_120px_1fr_1fr_24px] gap-3 text-xs text-[#576981] mb-1 px-1">
          <span />
          <span>Rate</span>
          <span>
            Tax Name <span className="text-[#C93E57]">*</span>
          </span>
          <span>Tax Number (Optional)</span>
          <span />
        </div>
      )}
      <div className="space-y-2">
        {taxes.map((t, i) => (
          <div
            key={i}
            className="grid grid-cols-[24px_120px_1fr_1fr_24px] gap-3 items-center"
          >
            <label className="inline-flex items-center justify-center w-6 h-6">
              <input
                type="checkbox"
                checked={t.enabled !== false}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-[#0075DD] focus:ring-[#0075DD]"
              />
            </label>
            <div className="relative">
              <input
                type="number"
                value={t.rate || ''}
                onChange={(e) =>
                  update(i, { rate: parseFloat(e.target.value) || 0 })
                }
                placeholder="0"
                step="0.01"
                min="0"
                className="w-full h-9 pl-3 pr-7 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]"
              />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm text-[#576981] border-l border-[#E1E6EB] pl-2">
                %
              </span>
            </div>
            <input
              type="text"
              value={t.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="GST"
              className="w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]"
            />
            <input
              type="text"
              value={t.number || ''}
              onChange={(e) => update(i, { number: e.target.value })}
              placeholder=""
              className="w-full h-9 px-3 border border-[#E1E6EB] rounded text-sm focus:outline-none focus:ring-1 focus:ring-[#0075DD] focus:border-[#0075DD]"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              title="Remove tax"
              className="text-[#576981] hover:text-[#C93E57]"
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
                  strokeWidth={1.7}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1.5 text-sm text-[#0075DD] font-medium hover:underline"
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Another Tax
        </button>
      </div>
    </div>
  )
}
