import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import { BOC_SERIES, fetchBocRates } from '@/lib/fx'

// ── Daily Bank of Canada rate refresh ───────────────────────────────────────
// getCadRate() only back-fills from BoC Valet when the fx_rates table has no
// row at all on or before the requested date, so without this job the newest
// stored rate is reused indefinitely. Hit by a server cron with the shared
// FX_REVAL_SECRET / PLAID_SYNC_SECRET (Authorization: Bearer <secret> or
// x-sync-secret). Upserts the last `days` days (default 10, max 90) for every
// mapped currency, so a missed run or a weekend heals on the next one.

// Constant-time secret check (hash both sides so length never leaks).
function secretOk(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

export async function POST(request: NextRequest) {
  const expected = process.env.FX_REVAL_SECRET || process.env.PLAID_SYNC_SECRET || ''
  const authz = request.headers.get('authorization') || ''
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : ''
  const provided = bearer || request.headers.get('x-sync-secret') || ''
  if (!expected || !secretOk(provided, expected)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawDays = Number(request.nextUrl.searchParams.get('days'))
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(90, Math.floor(rawDays)) : 10
  const end = new Date()
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days)

  const results: Array<{ currency: string; upserted?: number; error?: string }> = []
  for (const currency of Object.keys(BOC_SERIES)) {
    try {
      results.push({ currency, upserted: await fetchBocRates(currency, start, end) })
    } catch (err) {
      results.push({ currency, error: err instanceof Error ? err.message : 'failed' })
    }
  }

  const failed = results.filter((r) => r.error).length
  return Response.json({ ok: failed === 0, days, results }, { status: failed === results.length ? 502 : 200 })
}
