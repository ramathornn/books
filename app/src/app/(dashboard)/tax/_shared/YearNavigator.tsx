'use client'

import { useRouter } from 'next/navigation'

/**
 * Shared year navigator for the tax slip pages (list, summary, file). Renders a
 * prev/current/next stepper that pushes to the same route with the year swapped.
 * Reused by T5 and T4A (the same `basePath` pattern, just a different slug).
 *
 * `basePath` is the route prefix WITHOUT the year segment, e.g.
 * "/tax/t5" → pushes "/tax/t5?year=2024", or
 * "/tax/t5/summary" → pushes "/tax/t5/summary/2024" when `segment` is true.
 */
export default function YearNavigator({
  basePath,
  taxYear,
  segment = false,
  minYear = 2000,
  maxYear,
}: {
  basePath: string
  taxYear: number
  /** when true the year is a path segment (`/base/2025`); else a `?year=` query. */
  segment?: boolean
  minYear?: number
  maxYear?: number
}) {
  const router = useRouter()
  const cap = maxYear ?? new Date().getFullYear() + 1

  const go = (y: number) => {
    if (y < minYear || y > cap) return
    router.push(segment ? `${basePath}/${y}` : `${basePath}?year=${y}`)
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        onClick={() => go(taxYear - 1)}
        disabled={taxYear - 1 < minYear}
        className="px-2 py-1 rounded border border-[#D9E1EC] text-[#576981] hover:bg-[#F4F7FB] disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={`Go to ${taxYear - 1}`}
      >
        ← {taxYear - 1}
      </button>
      <span className="font-medium text-[#001B40] min-w-[3.5rem] text-center">{taxYear}</span>
      <button
        onClick={() => go(taxYear + 1)}
        disabled={taxYear + 1 > cap}
        className="px-2 py-1 rounded border border-[#D9E1EC] text-[#576981] hover:bg-[#F4F7FB] disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label={`Go to ${taxYear + 1}`}
      >
        {taxYear + 1} →
      </button>
    </div>
  )
}
