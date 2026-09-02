'use client'

// Hand-rolled SVG charts, matching the dashboard's dependency-free approach.
// Area/line, stacked bar, and donut, each with a hover tooltip.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { fmtMoney, fmtShort } from '@/lib/forecasts/computed'

export const CHART_COLORS = ['#0075DD', '#2FA84F', '#D9730D', '#9065B0', '#DE350B', '#337EA9', '#448361', '#CB912F']

const PAD = { top: 12, right: 28, bottom: 26, left: 48 }

/** Real pixel width of the chart container so text is never stretched. */
function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(800)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setW(Math.max(200, el.clientWidth))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) { min = Math.min(0, min); max = max === 0 ? 1000 : max * 1.1 }
  const span = max - min
  const rawStep = span / count
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)))
  const norm = rawStep / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}

function useScale(values: number[], height: number, includeZero = true) {
  return useMemo(() => {
    const vals = values.length ? values : [0]
    let min = Math.min(...vals)
    let max = Math.max(...vals)
    if (includeZero) { min = Math.min(0, min); max = Math.max(0, max) }
    const ticks = niceTicks(min, max)
    const lo = ticks[0]
    const hi = ticks[ticks.length - 1]
    const innerH = height - PAD.top - PAD.bottom
    const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH
    return { ticks, y, lo, hi, innerH }
  }, [values, height, includeZero])
}

interface Series { dataKey: string; color: string; name?: string }

function Tooltip({ x, y, title, rows }: { x: number; y: number; title: string; rows: { name: string; value: string; color: string }[] }) {
  return (
    <div className="pointer-events-none absolute z-20 rounded-md border border-gray-200 bg-white px-3 py-2 text-[12px] shadow-lg" style={{ left: x, top: y, transform: 'translate(-50%, -110%)' }}>
      <div className="mb-1 font-medium text-gray-900">{title}</div>
      {rows.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-gray-500"><span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} />{r.name}</span>
          <span className="tabular-nums text-gray-900">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Area (single series) or multi-line chart over months. */
export function AreaChart({ data, areas, height = 280, yFormatter = fmtShort, valueFormatter = fmtMoney }: {
  data: Record<string, number | string>[]
  areas: Series[]
  height?: number
  yFormatter?: (n: number) => string
  valueFormatter?: (n: number) => string
}) {
  const id = safeId(useId())
  const [wrapRef, W] = useContainerWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const all = data.flatMap((d) => areas.map((a) => Number(d[a.dataKey]) || 0))
  const { ticks, y } = useScale(all, height)
  const n = data.length
  const innerW = W - PAD.left - PAD.right
  const x = (i: number) => PAD.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const multi = areas.length > 1
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 8)

  if (!n) return <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>No data</div>

  return (
    <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="block"

        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          let best = 0, bd = Infinity
          for (let i = 0; i < n; i++) { const d = Math.abs(px - x(i)); if (d < bd) { bd = d; best = i } }
          setHover(best)
        }}>
        <defs>
          {areas.map((a) => (
            <linearGradient key={a.dataKey} id={`${id}-${safeId(a.dataKey)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={a.color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={a.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#EEF1F4" strokeDasharray="3 3" />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#8C9BAB">{yFormatter(t)}</text>
          </g>
        ))}
        {data.map((d, i) => (i % labelEvery === 0 || (i === n - 1 && i % labelEvery >= labelEvery / 2)) && (
          <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="#8C9BAB">{String(d.month)}</text>
        ))}
        {areas.map((a) => {
          const pts = data.map((d, i) => `${x(i)},${y(Number(d[a.dataKey]) || 0)}`)
          const line = `M${pts.join(' L')}`
          const area = `${line} L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`
          return (
            <g key={a.dataKey}>
              {!multi && <path d={area} fill={`url(#${id}-${safeId(a.dataKey)})`} />}
              <path d={line} fill="none" stroke={a.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          )
        })}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} stroke="#C9D1DA" />
            {areas.map((a) => <circle key={a.dataKey} cx={x(hover)} cy={y(Number(data[hover][a.dataKey]) || 0)} r={4} fill={a.color} stroke="#fff" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} y={PAD.top + 20} title={String(data[hover].month)} rows={areas.map((a) => ({ name: a.name || a.dataKey, value: valueFormatter(Number(data[hover][a.dataKey]) || 0), color: a.color }))} />
      )}
    </div>
  )
}

/** Vertical bars, optionally stacked; colorByValue paints positive/negative. */
export function BarChart({ data, bars, height = 280, stacked = false, colorByValue = false, showLegend = false }: {
  data: Record<string, number | string>[]
  bars: Series[]
  height?: number
  stacked?: boolean
  colorByValue?: boolean
  showLegend?: boolean
}) {
  const [wrapRef, W] = useContainerWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const n = data.length
  const totals = data.map((d) => {
    if (!stacked) return bars.map((b) => Number(d[b.dataKey]) || 0)
    const pos = bars.reduce((s, b) => s + Math.max(0, Number(d[b.dataKey]) || 0), 0)
    const neg = bars.reduce((s, b) => s + Math.min(0, Number(d[b.dataKey]) || 0), 0)
    return [pos, neg]
  }).flat()
  const { ticks, y } = useScale(totals, height)
  const innerW = W - PAD.left - PAD.right
  const slot = n ? innerW / n : innerW
  const groupW = slot * (n > 20 ? 0.85 : 0.7)
  const barW = stacked ? groupW : groupW / Math.max(1, bars.length)
  const labelEvery = n <= 8 ? 1 : Math.ceil(n / 8)

  if (!n) return <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>No data</div>

  return (
    <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="block"

        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const i = Math.min(n - 1, Math.max(0, Math.floor((px - PAD.left) / slot)))
          setHover(i)
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="#EEF1F4" strokeDasharray="3 3" />
            <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="#8C9BAB">{fmtShort(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = PAD.left + i * slot + (slot - groupW) / 2
          let posAcc = 0, negAcc = 0
          return (
            <g key={i}>
              {hover === i && <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={height - PAD.top - PAD.bottom} fill="rgba(0,0,0,0.03)" />}
              {bars.map((b, bi) => {
                const v = Number(d[b.dataKey]) || 0
                let top: number, bottom: number
                if (stacked) {
                  if (v >= 0) { bottom = posAcc; posAcc += v; top = posAcc } else { top = negAcc; negAcc += v; bottom = negAcc }
                } else { top = Math.max(0, v); bottom = Math.min(0, v) }
                const bx = stacked ? x0 : x0 + bi * barW
                const color = colorByValue ? (v >= 0 ? '#2FA84F' : '#DE350B') : b.color
                const h = Math.abs(y(top) - y(bottom))
                if (!h) return null
                return <rect key={b.dataKey} x={bx} y={Math.min(y(top), y(bottom))} width={Math.max(1, barW - 2)} height={h} fill={color} rx={stacked ? 0 : 2} />
              })}
              {(i % labelEvery === 0 || (i === n - 1 && i % labelEvery >= labelEvery / 2)) && <text x={PAD.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="#8C9BAB">{String(d.month)}</text>}
            </g>
          )
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#C9D1DA" />
      </svg>
      {hover !== null && (
        <Tooltip x={PAD.left + hover * slot + slot / 2} y={PAD.top + 20} title={String(data[hover].month)}
          rows={bars.filter((b) => Number(data[hover][b.dataKey]) !== 0 || bars.length === 1).map((b) => ({ name: b.name || b.dataKey, value: fmtMoney(Number(data[hover][b.dataKey]) || 0), color: colorByValue ? (Number(data[hover][b.dataKey]) >= 0 ? '#2FA84F' : '#DE350B') : b.color }))} />
      )}
      {showLegend && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2">
          {bars.map((b) => <span key={b.dataKey} className="flex items-center gap-1.5 text-[12px] text-gray-600"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />{b.name || b.dataKey}</span>)}
        </div>
      )}
    </div>
  )
}

/** Donut with centered total and legend. */
export function DonutChart({ data, height = 260 }: { data: { name: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0)
  const size = 200
  const cx = size / 2, cy = size / 2, R = 88, r = 60
  const cumulative = data.reduce<number[]>((out, d) => { out.push((out[out.length - 1] ?? 0) + d.value); return out }, [])
  const arcs = data.map((d, i) => {
    const before = i === 0 ? 0 : cumulative[i - 1]
    const start = (before / (total || 1)) * Math.PI * 2 - Math.PI / 2
    const end = (cumulative[i] / (total || 1)) * Math.PI * 2 - Math.PI / 2
    const large = end - start > Math.PI ? 1 : 0
    const p = (a: number, rad: number) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
    const [x1, y1] = p(start, R), [x2, y2] = p(end, R), [x3, y3] = p(end, r), [x4, y4] = p(start, r)
    const dPath = `M${x1},${y1} A${R},${R} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${r},${r} 0 ${large} 0 ${x4},${y4} Z`
    return { d: dPath, color: CHART_COLORS[i % CHART_COLORS.length], name: d.name, value: d.value }
  })

  if (!data.length) return <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>No data</div>

  return (
    <div className="flex flex-col items-center" style={{ minHeight: height }}>
      <div className="relative">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} onMouseLeave={() => setHover(null)}>
          {arcs.map((a, i) => <path key={a.name} d={a.d} fill={a.color} opacity={hover === null || hover === i ? 1 : 0.4} onMouseEnter={() => setHover(i)} />)}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[11px] uppercase tracking-wide text-gray-400">{hover === null ? 'Total' : arcs[hover].name}</span>
          <span className="text-[16px] font-semibold text-gray-900">{fmtMoney(hover === null ? total : arcs[hover].value)}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {arcs.map((a) => <span key={a.name} className="flex items-center gap-1.5 text-[12px] text-gray-600"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: a.color }} />{a.name}</span>)}
      </div>
    </div>
  )
}
