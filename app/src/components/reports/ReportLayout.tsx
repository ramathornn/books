'use client'

import { ReactNode, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import DashboardCurrencySelector from '@/components/ui/DashboardCurrencySelector'
import { isCalendarFiscalYear, type FiscalYearEnd } from '@/lib/fiscalYear'

export interface DateRange {
  from: string
  to: string
  label: string
}

export interface Preset {
  key: string
  label: string
}

interface Props {
  title: string
  breadcrumbLabel?: string
  breadcrumbHref?: string
  rangeLabel: string
  presets?: Preset[]
  currentPreset?: string
  filterSlot?: ReactNode
  tabs?: Array<{ value: string; label: string }>
  currentTab?: string
  betaBadge?: boolean
  updatedBadge?: boolean
  currency?: string
  /** Show a Cash/Accrual basis toggle (sync'd to ?basis=). Default: hidden. */
  showBasisToggle?: boolean
  /** Show a Compact density toggle (sync'd to ?compact=1). Default: hidden. */
  showCompactToggle?: boolean
  /** Company name to render under the title in the report header. */
  companyName?: string
  /**
   * The company's fiscal year-end. When given AND it isn't Dec 31, the date-range
   * dropdown grows a second, explicitly-labelled group of fiscal presets
   * alongside the calendar ones. Omitted or Dec 31 → calendar only,
   * since the two sets would be identical.
   */
  fiscalYearEnd?: FiscalYearEnd
  /**
   * This report has a `{pathname}/export` route handler — show the Download
   * button (CSV / Excel). Default: hidden, so reports without an export route
   * don't render a dead control.
   */
  hasExport?: boolean
  children: ReactNode
}

const DEFAULT_PRESETS: Preset[] = [
  { key: 'this-month', label: 'This Month' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'this-quarter', label: 'This Quarter' },
  { key: 'last-quarter', label: 'Last Quarter' },
  { key: 'this-year', label: 'This Year' },
  { key: 'last-year', label: 'Last Year' },
  { key: 'this-year-to-date', label: 'Year to Date' },
]

/**
 * Fiscal counterparts, appended as a separate labelled group when the company's
 * fiscal year-end isn't Dec 31. Additive: no calendar preset changes meaning, so
 * every saved report link keeps rendering what it renders today — and an
 * accountant still gets the calendar year for GST periods, T4/T5 slips, and
 * personal-return tie-outs.
 */
const FISCAL_PRESETS: Preset[] = [
  { key: 'this-fiscal-quarter', label: 'This Fiscal Quarter' },
  { key: 'last-fiscal-quarter', label: 'Last Fiscal Quarter' },
  { key: 'this-fiscal-year', label: 'This Fiscal Year' },
  { key: 'last-fiscal-year', label: 'Last Fiscal Year' },
  { key: 'this-fiscal-year-to-date', label: 'Fiscal Year to Date' },
]

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export default function ReportLayout({
  title,
  breadcrumbLabel = 'Reports',
  breadcrumbHref = '/reports',
  rangeLabel,
  presets = DEFAULT_PRESETS,
  currentPreset = 'this-year',
  filterSlot,
  tabs,
  currentTab,
  betaBadge,
  updatedBadge,
  currency,
  showBasisToggle,
  showCompactToggle,
  companyName,
  fiscalYearEnd,
  hasExport,
  children,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [showFilters, setShowFilters] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const presetsRef = useRef<HTMLDivElement>(null)
  const moreActionsRef = useRef<HTMLDivElement>(null)
  const downloadRef = useRef<HTMLDivElement>(null)

  // Close the presets / Download / More Actions dropdowns on any click outside
  // them (mousedown, matching the app's other dropdowns).
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setShowPresets(false)
      }
      if (moreActionsRef.current && !moreActionsRef.current.contains(e.target as Node)) {
        setShowMoreActions(false)
      }
      if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) {
        setShowDownload(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  // The fiscal group only renders when a non-Dec-31 year-end was threaded in —
  // with a Dec-31 year-end the fiscal presets resolve identically to their
  // calendar twins, so showing both would be pure noise.
  const showFiscal = !!fiscalYearEnd && !isCalendarFiscalYear(fiscalYearEnd)
  const effectivePresets = showFiscal ? [...presets, ...FISCAL_PRESETS] : presets

  // Known preset keys include DEFAULT_PRESETS plus any caller-supplied presets,
  // plus the fiscal keys UNCONDITIONALLY — a bookmarked ?preset=this-fiscal-year
  // must still resolve for tab-highlighting and the range-button label even on a
  // page (or a company) where the fiscal group isn't rendered.
  const presetKeys = new Set<string>([
    ...DEFAULT_PRESETS.map((p) => p.key),
    ...FISCAL_PRESETS.map((p) => p.key),
    ...presets.map((p) => p.key),
  ])
  const urlTab = searchParams.get('tab') || 'default'
  const activeTab = currentTab ?? urlTab
  const basis = (searchParams.get('basis') || 'accrual') as 'accrual' | 'cash'
  const compact = searchParams.get('compact') === '1'
  const hasCustomRange = !!(searchParams.get('start') && searchParams.get('end'))
  const [customStart, setCustomStart] = useState(searchParams.get('start') || '')
  const [customEnd, setCustomEnd] = useState(searchParams.get('end') || '')

  function setParam(k: string, v: string | null) {
    const p = new URLSearchParams(searchParams.toString())
    if (v) p.set(k, v)
    else p.delete(k)
    router.push(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function setParams(updates: Array<[string, string | null]>) {
    const p = new URLSearchParams(searchParams.toString())
    for (const [k, v] of updates) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    router.push(`${pathname}?${p.toString()}`, { scroll: false })
  }

  function onTabClick(value: string) {
    // Preset-shortcut tabs swap the active preset (and clear any view-mode tab and
    // custom range). View-mode tabs (vs-last-year, percent, detail) just set `tab`,
    // leaving preset/range alone.
    if (value === 'default' || presetKeys.has(value)) {
      setParams([
        ['preset', value === 'default' ? null : value],
        ['tab', null],
        ['start', null],
        ['end', null],
      ])
    } else {
      setParam('tab', value)
    }
  }

  function applyCustomRange() {
    if (!customStart || !customEnd || customStart > customEnd) return
    setParams([
      ['start', customStart],
      ['end', customEnd],
      ['preset', null],
    ])
    setShowPresets(false)
  }

  function download(format: 'csv' | 'xlsx') {
    const p = new URLSearchParams(searchParams.toString())
    p.set('format', format)
    window.open(`${pathname}/export?${p.toString()}`, '_blank')
    setShowDownload(false)
  }

  /** Label for the date-range button: real dates when a custom range is active. */
  function fmtDateParam(raw: string): string {
    const [y, m, d] = raw.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const rangeButtonLabel = hasCustomRange
    ? `${fmtDateParam(searchParams.get('start')!)} – ${fmtDateParam(searchParams.get('end')!)}`
    : effectivePresets.find((p) => p.key === currentPreset)?.label || 'Date Range'

  // Computed from the prop, never hardcoded — every company has a different one.
  const fiscalCaption = fiscalYearEnd
    ? `Fiscal year (ends ${MONTH_NAMES[fiscalYearEnd.month - 1]} ${fiscalYearEnd.day})`
    : ''

  return (
    <div>
      <div className="mb-4">
        <Link href={breadcrumbHref} className="text-xs text-[#0075DD] hover:underline">
          {breadcrumbLabel}
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[28px] sm:text-[40px] font-medium text-[#001B40] leading-none" style={{ fontFamily: 'var(--font-heading)' }}>
              {title}
            </h1>
            {betaBadge && (
              <span className="text-xs bg-[#FFF0E6] text-[#8B4513] px-2 py-0.5 rounded font-semibold">BETA</span>
            )}
            {updatedBadge && (
              <span className="text-xs bg-[#E3FCEF] text-[#006644] px-2 py-0.5 rounded font-semibold">UPDATED</span>
            )}
          </div>
          <div className="mt-2 text-sm text-[#576981]">{rangeLabel}</div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {showBasisToggle && (
            <div className="inline-flex rounded border border-[#E1E6EB] bg-white overflow-hidden text-sm">
              <button
                onClick={() => setParam('basis', null)}
                className={`px-3 py-1.5 ${basis === 'accrual' ? 'bg-[#F0F8FE] text-[#001B40] font-medium' : 'text-[#576981] hover:bg-[#F5F7FA]'}`}
              >
                Accrual
              </button>
              <button
                onClick={() => setParam('basis', 'cash')}
                className={`px-3 py-1.5 border-l border-[#E1E6EB] ${basis === 'cash' ? 'bg-[#F0F8FE] text-[#001B40] font-medium' : 'text-[#576981] hover:bg-[#F5F7FA]'}`}
              >
                Cash
              </button>
            </div>
          )}
          {showCompactToggle && (
            <button
              onClick={() => setParam('compact', compact ? null : '1')}
              className={`px-3 py-1.5 text-sm border rounded ${compact ? 'bg-[#F0F8FE] border-[#0075DD] text-[#001B40]' : 'bg-white border-[#E1E6EB] text-[#576981] hover:bg-[#F5F7FA]'}`}
            >
              Compact
            </button>
          )}
          {currency && <DashboardCurrencySelector selected={currency} />}
          <div className="relative" ref={presetsRef}>
            <button
              onClick={() => setShowPresets(!showPresets)}
              className="px-3 py-1.5 text-sm text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {rangeButtonLabel}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showPresets && (
              <div className="absolute right-0 mt-1 w-56 bg-white border border-[#E1E6EB] rounded shadow-lg z-10">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      // Switching preset via the date-range dropdown drops any custom
                      // range but KEEPS the view-mode tab: the date range and the column
                      // layout are independent choices, so re-dating a report shouldn't
                      // silently throw the reader back to the single-column view.
                      // (Preset-shortcut TABS still clear it — see onTabClick.)
                      setParams([['preset', p.key], ['start', null], ['end', null]])
                      setShowPresets(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#F5F7FA] ${
                      currentPreset === p.key && !hasCustomRange ? 'text-[#0075DD] font-semibold' : 'text-[#001B40]'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
                {showFiscal && (
                  <div className="border-t border-[#E1E6EB] pt-2">
                    <div className="px-3 pb-1 text-xs font-semibold text-[#576981]">{fiscalCaption}</div>
                    {FISCAL_PRESETS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => {
                          setParams([['preset', p.key], ['start', null], ['end', null]])
                          setShowPresets(false)
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-[#F5F7FA] ${
                          currentPreset === p.key && !hasCustomRange ? 'text-[#0075DD] font-semibold' : 'text-[#001B40]'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-t border-[#E1E6EB] px-3 py-2">
                  <div className={`text-xs font-semibold mb-1.5 ${hasCustomRange ? 'text-[#0075DD]' : 'text-[#576981]'}`}>Custom range</div>
                  <label className="block text-xs text-[#576981] mb-0.5">From</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full mb-1.5 px-2 py-1 text-sm border border-[#E1E6EB] rounded text-[#001B40]"
                    aria-label="Start date"
                  />
                  <label className="block text-xs text-[#576981] mb-0.5">To</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full mb-1.5 px-2 py-1 text-sm border border-[#E1E6EB] rounded text-[#001B40]"
                    aria-label="End date"
                  />
                  <button
                    onClick={applyCustomRange}
                    disabled={!customStart || !customEnd || customStart > customEnd}
                    className="w-full px-2 py-1 text-sm rounded bg-[#0075DD] text-white disabled:opacity-40 hover:bg-[#005FB8]"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          {filterSlot && (
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="px-3 py-1.5 text-sm text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA] flex items-center gap-1"
            >
              Filters
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
          )}

          {hasExport && (
            <div className="relative" ref={downloadRef}>
              <button
                onClick={() => setShowDownload(!showDownload)}
                className="px-4 py-1.5 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                </svg>
                Download ▾
              </button>
              {showDownload && (
                <div className="absolute right-0 mt-1 w-44 bg-white border border-[#E1E6EB] rounded shadow-lg z-10">
                  <button
                    onClick={() => download('csv')}
                    className="w-full text-left px-3 py-2 text-sm text-[#001B40] hover:bg-[#F5F7FA]"
                  >
                    CSV (.csv)
                  </button>
                  <button
                    onClick={() => download('xlsx')}
                    className="w-full text-left px-3 py-2 text-sm text-[#001B40] hover:bg-[#F5F7FA]"
                  >
                    Excel (.xlsx)
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="relative" ref={moreActionsRef}>
            <button
              onClick={() => setShowMoreActions(!showMoreActions)}
              className="px-3 py-1.5 text-sm text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              More Actions ▾
            </button>
            {showMoreActions && (
              <div className="absolute right-0 mt-1 w-44 bg-white border border-[#E1E6EB] rounded shadow-lg z-10">
                <button
                  onClick={() => { window.print(); setShowMoreActions(false) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5F7FA]"
                >
                  Print
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {tabs && tabs.length > 0 && (
        <div className="border-b border-[#E1E6EB] mb-4">
          <div className="flex gap-6">
            {/* `default` tab wins when no other preset-value tab in this list matches currentPreset. */}
            {(() => {
              const otherPresetTabMatches = tabs.some(
                (t) => t.value !== 'default' && presetKeys.has(t.value) && t.value === currentPreset,
              )
              return tabs.map((t) => {
              const isPresetTab = t.value === 'default' || presetKeys.has(t.value)
              const highlighted = isPresetTab
                ? (t.value === 'default'
                    ? activeTab === 'default' && !otherPresetTabMatches
                    : currentPreset === t.value && activeTab === 'default')
                : activeTab === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => onTabClick(t.value)}
                  className={`px-1 pb-2 text-sm font-medium border-b-2 -mb-px ${
                    highlighted
                      ? 'text-[#001B40] border-[#0075DD]'
                      : 'text-[#576981] border-transparent hover:text-[#001B40]'
                  }`}
                >
                  {t.label}
                </button>
              )
            })
            })()}
          </div>
        </div>
      )}

      <div className={showFilters ? 'grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6' : ''}>
        <div className={`bg-white rounded-lg border border-[#E1E6EB] ${compact ? 'p-2 sm:p-3' : 'p-3 sm:p-6'} print:border-0 print:shadow-none overflow-x-auto`}>
          {companyName && (
            <div className="text-center mb-4 print:mb-2">
              <div className="text-base font-semibold text-[#001B40]">{companyName}</div>
              <div className="text-sm text-[#001B40]">{title}</div>
              <div className="text-xs text-[#576981] mt-0.5">{rangeLabel}</div>
            </div>
          )}
          {children}
          <div className="mt-6 pt-3 border-t border-[#E1E6EB] text-[10px] text-[#576981]">
            {basis === 'cash' ? 'Cash basis' : 'Accrual basis'} | {new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}
          </div>
        </div>
        {showFilters && filterSlot && (
          <aside className="bg-white rounded-lg border border-[#E1E6EB] p-4 h-fit sticky top-6 print:hidden">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#001B40]">Filters</h3>
              <button
                onClick={() => setShowFilters(false)}
                className="text-xs text-[#576981] hover:text-[#001B40]"
              >
                Close
              </button>
            </div>
            {filterSlot}
          </aside>
        )}
      </div>
    </div>
  )
}
