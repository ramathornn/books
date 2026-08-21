import prisma from '@/lib/prisma'

export const BOC_SERIES: Record<string, string> = {
  USD: 'FXUSDCAD', EUR: 'FXEURCAD', GBP: 'FXGBPCAD', AUD: 'FXAUDCAD',
  JPY: 'FXJPYCAD', CHF: 'FXCHFCAD', MXN: 'FXMXNCAD',
}

export class FxRateUnavailableError extends Error {
  code = 'FX_RATE_UNAVAILABLE'
  constructor(public currency: string, public onDate: string) {
    super(`No CAD exchange rate available for ${currency} on or before ${onDate}`)
    this.name = 'FxRateUnavailableError'
  }
}

export interface ResolvedRate { rate: number; rateDate: Date; source: string; seriesName: string }
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
function dateKey(d: Date): string { return d.toISOString().slice(0, 10) }

export function toAccountingDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

export async function getCadRate(currency: string, date: Date): Promise<ResolvedRate> {
  const ccy = currency.toUpperCase()
  if (ccy === 'CAD') return { rate: 1, rateDate: toAccountingDate(date), source: 'IDENTITY', seriesName: '' }
  const onDate = toAccountingDate(date)
  const hit = await prisma.fxRate.findFirst({ where: { currency: ccy, rateDate: { lte: onDate } }, orderBy: { rateDate: 'desc' } })
  if (hit) return { rate: Number(hit.cadPerUnit), rateDate: hit.rateDate, source: hit.source, seriesName: hit.seriesName }
  const start = new Date(onDate); start.setUTCDate(start.getUTCDate() - 10)
  try { await fetchBocRates(ccy, start, onDate) } catch { /* fall through */ }
  const after = await prisma.fxRate.findFirst({ where: { currency: ccy, rateDate: { lte: onDate } }, orderBy: { rateDate: 'desc' } })
  if (after) return { rate: Number(after.cadPerUnit), rateDate: after.rateDate, source: after.source, seriesName: after.seriesName }
  const latest = await prisma.fxRate.findFirst({ where: { currency: ccy }, orderBy: { rateDate: 'desc' } })
  if (latest) return { rate: Number(latest.cadPerUnit), rateDate: latest.rateDate, source: latest.source + ':stale', seriesName: latest.seriesName }
  throw new FxRateUnavailableError(ccy, dateKey(onDate))
}

export async function convertToCad(amount: number, currency: string, date: Date): Promise<number> {
  const { rate } = await getCadRate(currency, date)
  return round2(amount * rate)
}

export function convertInvoiceToCad(subtotal: number, taxTotal: number, discount: number, total: number, rate: number, opts: { exactTaxFace?: boolean } = {}): { cadSubtotal: number; cadTaxTotal: number; cadDiscount: number; cadTotal: number } {
  const cadTotal = round2(total * rate)
  const cadTaxTotal = opts.exactTaxFace ? round2(taxTotal) : round2(taxTotal * rate)
  const cadDiscount = round2(discount * rate)
  const cadSubtotal = round2(cadTotal + cadDiscount - cadTaxTotal)
  return { cadSubtotal, cadTaxTotal, cadDiscount, cadTotal }
}

interface BocObservation { d: string; [series: string]: { v: string } | string }

export async function fetchBocRates(currency: string, start: Date, end: Date): Promise<number> {
  const ccy = currency.toUpperCase()
  const series = BOC_SERIES[ccy]
  if (!series) throw new Error(`No BoC Valet series mapped for currency ${ccy}`)
  const sd = start.toISOString().slice(0, 10); const ed = end.toISOString().slice(0, 10)
  const url = `https://www.bankofcanada.ca/valet/observations/${series}/json?start_date=${sd}&end_date=${ed}`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`BoC Valet HTTP ${res.status} for ${series} (${sd}..${ed})`)
  const json = (await res.json()) as { observations?: BocObservation[] }
  const obs = json.observations ?? []
  let count = 0
  for (const o of obs) {
    const cell = o[series]
    const raw = typeof cell === 'object' && cell ? (cell as { v: string }).v : undefined
    if (!raw) continue
    const val = Number(raw)
    if (!Number.isFinite(val) || val <= 0) continue
    const rateDate = new Date(`${o.d}T00:00:00.000Z`)
    await prisma.fxRate.upsert({
      where: { currency_rateDate: { currency: ccy, rateDate } },
      create: { currency: ccy, rateDate, cadPerUnit: val, source: 'boc_valet', seriesName: series },
      update: { cadPerUnit: val, source: 'boc_valet', seriesName: series, fetchedAt: new Date() },
    })
    count++
  }
  return count
}
