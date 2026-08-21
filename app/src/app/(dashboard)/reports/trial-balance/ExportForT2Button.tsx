'use client'

import { useSearchParams } from 'next/navigation'

/**
 * Downloads the trial balance as a GIFI-keyed CSV for a T2 return, forwarding
 * the report's current currency / preset / asOf params so the export ties out to
 * what's on screen. Opens the dedicated CSV route in a new tab.
 */
export default function ExportForT2Button() {
  const searchParams = useSearchParams()

  function exportT2() {
    const qs = searchParams.toString()
    window.open(`/api/reports/trial-balance/t2-export${qs ? `?${qs}` : ''}`, '_blank')
  }

  return (
    <button
      onClick={exportT2}
      className="px-3 py-1.5 text-sm text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
    >
      Export for T2
    </button>
  )
}
