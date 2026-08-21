import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { getCadRate, toAccountingDate, FxRateUnavailableError } from '@/lib/fx'
import { createJournalEntry } from '@/lib/journalEntry'
import { audit } from '@/lib/audit'

// ── Month-end unrealized-FX revaluation cron ────────────────────────────────
// Secret-guarded endpoint (mirrors /api/plaid/sync-all). For a given month-end
// date it revalues every non-CAD-denominated GL balance (foreign A/R, Wise
// EUR/USD bank accounts — any GLAccount whose currency != CAD) at the Bank of
// Canada month-end rate (src/lib/fx.ts getCadRate, which back-fills from BoC
// Valet) and posts the unrealized gain/loss to "Unrealized Currency Gains"
// (account 498) via createJournalEntry — DR/CR the 498 account vs the revalued
// account.
//
// Accounting model (important): the GL is a CAD ledger. Foreign transactions
// are posted in CAD at their historical rate (see src/lib/invoicePosting.ts),
// so the sum of posted JE lines on a non-CAD account is its *booked CAD
// carrying value*, while the account's *native balance* lives on the source
// documents (BankTransaction.amount for bank accounts, Invoice native totals
// otherwise). Revaluation = (nativeBalance × monthEndRate) − bookedCad. We post
// that delta so the carrying value matches the month-end revalued amount.
//
// Idempotent per month: a posted `kind:'fx-reval'` JE dated at the month-end is
// detected and the run is skipped (unless `force`). Preview mode (`preview` or
// GET) computes the same rows without posting.

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

// Constant-time secret check (hash both sides so length never leaks).
function secretOk(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

function checkSecret(request: NextRequest): boolean {
  const expected = process.env.FX_REVAL_SECRET || process.env.PLAID_SYNC_SECRET || ''
  const authz = request.headers.get('authorization') || ''
  const bearer = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : ''
  const provided = bearer || request.headers.get('x-sync-secret') || ''
  return !!expected && secretOk(provided, expected)
}

// Last calendar day of the month containing `d`, as a UTC accounting date.
function monthEnd(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
}

interface RevalRow {
  accountId: string
  accountNumber: string
  accountName: string
  accountClass: string
  currency: string
  nativeBalance: number
  rate: number
  rateDate: string
  rateSource: string
  bookedCad: number
  revaluedCad: number
  unrealized: number
}

interface RevalResult {
  asOf: string
  rows: RevalRow[]
  totalUnrealized: number
  errors: Array<{ accountId: string; currency: string; error: string }>
}

// Sum of posted JE lines on an account up to `asOf`, as a signed balance in the
// account's normal direction (debit-normal → debit−credit). This is the booked
// CAD carrying value, including any opening balance and prior reval JEs.
async function bookedCadBalance(accountIds: string[], asOf: Date): Promise<Map<string, number>> {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      glAccountId: { in: accountIds },
      journalEntry: { status: 'posted', entryDate: { lte: asOf } },
    },
    select: { glAccountId: true, debit: true, credit: true },
  })
  const out = new Map<string, number>()
  for (const l of lines) {
    out.set(l.glAccountId, (out.get(l.glAccountId) || 0) + (Number(l.debit) - Number(l.credit)))
  }
  return out
}

// Native-currency balance of a non-CAD account as of `asOf`. For accounts that
// back a BankAccount, sum posted BankTransaction.amount (stored in native ccy);
// otherwise sum native invoice amountDue for matching-currency invoices. The
// account's openingBalance (native) seeds both.
async function nativeBalances(
  accounts: Array<{ id: string; currency: string; openingBalance: unknown; bankAccount: { id: string } | null }>,
  asOf: Date
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const a of accounts) out.set(a.id, Number(a.openingBalance))

  // Bank-backed accounts: native = openingBalance + Σ posted txn amounts ≤ asOf.
  const bankBacked = accounts.filter((a) => a.bankAccount)
  if (bankBacked.length) {
    const grouped = await prisma.bankTransaction.groupBy({
      by: ['bankAccountId'],
      where: {
        bankAccountId: { in: bankBacked.map((a) => a.bankAccount!.id) },
        status: 'posted',
        transactionDate: { lte: asOf },
      },
      _sum: { amount: true },
    })
    const byBank = new Map(grouped.map((g) => [g.bankAccountId, Number(g._sum.amount || 0)]))
    for (const a of bankBacked) {
      out.set(a.id, Number(a.openingBalance) + (byBank.get(a.bankAccount!.id) || 0))
    }
  }

  // A/R-style accounts (non-bank): native = openingBalance + Σ native amountDue
  // for unpaid invoices in the same currency issued ≤ asOf. (Single-currency GL
  // accounts are assumed — each non-CAD account carries one currency.)
  const arBacked = accounts.filter((a) => !a.bankAccount)
  for (const a of arBacked) {
    const agg = await prisma.invoice.aggregate({
      where: {
        currency: a.currency,
        dateIssued: { lte: asOf },
        status: { notIn: ['draft', 'void', 'paid', 'bad_debt'] },
      },
      _sum: { amountDue: true },
    })
    const due = Number(agg._sum.amountDue || 0)
    if (due !== 0) out.set(a.id, Number(a.openingBalance) + due)
  }

  return out
}

async function computeRevaluation(asOf: Date): Promise<RevalResult> {
  const accounts = await prisma.gLAccount.findMany({
    where: { isArchived: false, currency: { not: 'CAD' } },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    include: { bankAccount: { select: { id: true } } },
  })

  const ids = accounts.map((a) => a.id)
  const [booked, native] = await Promise.all([
    bookedCadBalance(ids, asOf),
    nativeBalances(accounts, asOf),
  ])

  // Resolve a month-end rate per distinct non-CAD currency (cache the lookups).
  const rateByCcy = new Map<string, { rate: number; rateDate: string; source: string }>()
  const errors: RevalResult['errors'] = []
  for (const ccy of new Set(accounts.map((a) => a.currency))) {
    try {
      const r = await getCadRate(ccy, asOf)
      rateByCcy.set(ccy, { rate: r.rate, rateDate: r.rateDate.toISOString().slice(0, 10), source: r.source })
    } catch (e) {
      const msg = e instanceof FxRateUnavailableError ? e.message : e instanceof Error ? e.message : 'rate lookup failed'
      // Mark every account in this currency as errored below.
      rateByCcy.set(ccy, { rate: NaN, rateDate: '', source: 'unavailable' })
      errors.push({ accountId: '', currency: ccy, error: msg })
    }
  }

  const rows: RevalRow[] = []
  for (const a of accounts) {
    const rate = rateByCcy.get(a.currency)
    const nativeBalance = round2(native.get(a.id) || 0)
    const bookedCad = round2(booked.get(a.id) || 0)
    if (Math.abs(nativeBalance) < 0.005 && Math.abs(bookedCad) < 0.005) continue
    if (!rate || !Number.isFinite(rate.rate)) {
      if (!errors.some((e) => e.currency === a.currency && e.accountId === a.id)) {
        errors.push({ accountId: a.id, currency: a.currency, error: `No CAD month-end rate for ${a.currency}` })
      }
      continue
    }
    const revaluedCad = round2(nativeBalance * rate.rate)
    const unrealized = round2(revaluedCad - bookedCad)
    rows.push({
      accountId: a.id,
      accountNumber: a.accountNumber,
      accountName: a.accountName,
      accountClass: a.accountClass,
      currency: a.currency,
      nativeBalance,
      rate: rate.rate,
      rateDate: rate.rateDate,
      rateSource: rate.source,
      bookedCad,
      revaluedCad,
      unrealized,
    })
  }

  const totalUnrealized = round2(rows.reduce((s, r) => s + r.unrealized, 0))
  return { asOf: asOf.toISOString().slice(0, 10), rows, totalUnrealized, errors }
}

// Locate the "Unrealized Currency Gains" account (498), with name fallbacks.
async function findFxAccount() {
  return prisma.gLAccount.findFirst({
    where: {
      OR: [
        { accountNumber: '498' },
        { accountName: { contains: 'Unrealized Currency', mode: 'insensitive' } },
        { detailType: 'Unrealized Currency Gains' },
        { accountName: { contains: 'Foreign Exchange', mode: 'insensitive' } },
      ],
    },
    orderBy: { accountNumber: 'asc' },
  })
}

// Has a revaluation already been posted for this month-end?
async function existingRevalJE(asOf: Date) {
  return prisma.journalEntry.findFirst({
    where: { kind: 'fx-reval', status: 'posted', entryDate: asOf },
    select: { id: true, entryNumber: true },
  })
}

async function run(request: NextRequest, opts: { preview: boolean }) {
  if (!checkSecret(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // asOf comes from the query/body; default to the current month-end. Always
  // snap to the last calendar day of that month so the run is deterministic.
  const url = new URL(request.url)
  let body: Record<string, unknown> = {}
  if (request.method !== 'GET') {
    body = await request.json().catch(() => ({}))
  }
  const asOfRaw = String(body.asOf || url.searchParams.get('asOf') || '')
  const base = asOfRaw ? new Date(asOfRaw) : new Date()
  if (isNaN(base.getTime())) return Response.json({ error: 'asOf invalid' }, { status: 400 })
  const asOf = monthEnd(toAccountingDate(base))

  const force = body.force === true || url.searchParams.get('force') === '1'
  const preview = opts.preview || body.preview === true || url.searchParams.get('preview') === '1'

  const fxAccount = await findFxAccount()
  const already = await existingRevalJE(asOf)
  const result = await computeRevaluation(asOf)

  // Preview / dry-run: never posts.
  if (preview) {
    return Response.json({
      ok: true,
      preview: true,
      alreadyPosted: already ? { id: already.id, entryNumber: already.entryNumber } : null,
      fxAccount: fxAccount ? { id: fxAccount.id, accountNumber: fxAccount.accountNumber, accountName: fxAccount.accountName } : null,
      ...result,
    })
  }

  // Idempotent: skip if a reval JE already exists for this month-end.
  if (already && !force) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: 'already-posted',
      asOf: result.asOf,
      journalEntryId: already.id,
      entryNumber: already.entryNumber,
    })
  }

  if (!fxAccount) {
    return Response.json(
      { error: 'No Unrealized Currency Gains (498) account found in chart.', errors: result.errors },
      { status: 500 }
    )
  }

  const postable = result.rows.filter((r) => Math.abs(r.unrealized) > 0.005)
  if (postable.length === 0) {
    return Response.json({
      ok: true,
      posted: false,
      reason: 'nothing-to-revalue',
      asOf: result.asOf,
      errors: result.errors,
    })
  }

  // Build the JE: for each account, post the unrealized delta in its normal
  // direction (debit-normal → DR on gain, CR on loss); the net offsets to 498.
  const jeLines: Array<{ glAccountId: string; description: string; debit: number; credit: number }> = []
  let netToFx = 0 // CAD amount that must hit 498 (income, credit-normal)
  for (const r of postable) {
    const debitNormal = r.accountClass === 'asset' || r.accountClass === 'expense'
    const u = r.unrealized
    const desc = `FX reval ${r.currency}@${r.rate} (${r.accountNumber})`
    if (debitNormal) {
      if (u > 0) jeLines.push({ glAccountId: r.accountId, description: desc, debit: u, credit: 0 })
      else jeLines.push({ glAccountId: r.accountId, description: desc, debit: 0, credit: -u })
      netToFx += u
    } else {
      if (u > 0) jeLines.push({ glAccountId: r.accountId, description: desc, debit: 0, credit: u })
      else jeLines.push({ glAccountId: r.accountId, description: desc, debit: -u, credit: 0 })
      netToFx -= u
    }
  }

  // Offset to 498 (credit-normal income). netToFx > 0 → net gain → CR 498.
  netToFx = round2(netToFx)
  if (netToFx > 0) jeLines.push({ glAccountId: fxAccount.id, description: 'Unrealized FX gain', debit: 0, credit: netToFx })
  else if (netToFx < 0) jeLines.push({ glAccountId: fxAccount.id, description: 'Unrealized FX loss', debit: -netToFx, credit: 0 })

  // Penny-rounding fix on the 498 line so debits == credits exactly.
  const td = round2(jeLines.reduce((s, l) => s + l.debit, 0))
  const tc = round2(jeLines.reduce((s, l) => s + l.credit, 0))
  const diff = round2(td - tc)
  if (diff !== 0) {
    const last = jeLines[jeLines.length - 1]
    if (last.debit > 0) last.debit = round2(last.debit - diff)
    else last.credit = round2(last.credit + diff)
  }

  let je
  try {
    je = await createJournalEntry({
      entryDate: asOf,
      description: `Unrealized FX revaluation @ ${result.asOf}`,
      memo: `Month-end BoC revaluation · net ${result.totalUnrealized.toFixed(2)} CAD`,
      status: 'posted',
      kind: 'fx-reval',
      lines: jeLines,
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'PERIOD_LOCKED') {
      return Response.json({ error: (e as Error).message, code: 'PERIOD_LOCKED' }, { status: 409 })
    }
    throw e
  }

  await audit({
    entityType: 'journal_entry',
    entityId: je.id,
    action: 'post',
    summary: `FX revaluation @ ${result.asOf} · net ${result.totalUnrealized.toFixed(2)} CAD`,
    metadata: {
      asOf: result.asOf,
      totalUnrealized: result.totalUnrealized,
      accounts: postable.length,
      rates: result.rows.map((r) => ({ ccy: r.currency, rate: r.rate, rateDate: r.rateDate, source: r.rateSource })),
      errors: result.errors,
      cron: true,
    },
  })

  return Response.json({
    ok: true,
    posted: true,
    asOf: result.asOf,
    journalEntryId: je.id,
    entryNumber: je.entryNumber,
    totalUnrealized: result.totalUnrealized,
    accounts: postable.length,
    rows: postable,
    errors: result.errors,
  })
}

// POST = post (or preview when ?preview=1 / {preview:true}). GET = preview only.
export async function POST(request: NextRequest) {
  return run(request, { preview: false })
}

export async function GET(request: NextRequest) {
  return run(request, { preview: true })
}
