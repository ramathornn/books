import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import prisma from '@/lib/prisma'
import { requireApiAuth } from '@/lib/apiBearerAuth'
import { getPeriodLock } from '@/lib/periodLock'
import { balancesAsOf, parseAsOfParam } from '@/lib/glBalances'

// Read-only JSON snapshot of the books for an external auditing agent.
//
// Auth: accepts EITHER this route's dedicated AUDIT_API_KEY (sent as
// `Authorization: Bearer <key>` or `x-api-key: <key>`) OR the shared file-API
// auth (a `Authorization: Bearer <FILES_API_TOKEN>` token, or a NextAuth
// session). The endpoint FAILS CLOSED — if neither AUDIT_API_KEY nor
// FILES_API_TOKEN is configured and there is no session, every request is
// rejected, so the books are never exposed without explicit credentials. Keep
// any configured key/token strong and secret; rotate via the env var + restart.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Constant-time comparison that doesn't leak length (hash both sides first).
function keysMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}

function unauthorized() {
  return Response.json(
    { error: 'Unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } }
  )
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export async function GET(request: NextRequest) {
  // ---- Auth (fail closed) ----
  // Accept EITHER the shared file-API auth (bearer FILES_API_TOKEN or a NextAuth
  // session) OR this route's dedicated AUDIT_API_KEY. The endpoint still fails
  // closed: if neither AUDIT_API_KEY nor FILES_API_TOKEN is configured and no
  // session is present, every request is rejected so the books stay private.
  const expected = process.env.AUDIT_API_KEY
  const auditKeyConfigured = !!expected && expected.length >= 16
  const filesTokenConfigured =
    !!process.env.FILES_API_TOKEN && process.env.FILES_API_TOKEN.length >= 16

  // (a) Shared file-API auth (bearer token or interactive session).
  const shared = await requireApiAuth(request)

  // (b) Dedicated AUDIT_API_KEY (bearer or x-api-key header).
  let auditKeyOk = false
  if (auditKeyConfigured) {
    const authz = request.headers.get('authorization') || ''
    const bearer = authz.toLowerCase().startsWith('bearer ')
      ? authz.slice(7).trim()
      : ''
    const provided = bearer || request.headers.get('x-api-key') || ''
    auditKeyOk = !!provided && keysMatch(provided, expected as string)
  }

  if (!shared.ok && !auditKeyOk) {
    // Misconfigured (no key/token) AND no session => not configured.
    if (!auditKeyConfigured && !filesTokenConfigured) {
      return Response.json(
        { error: 'Audit snapshot is not configured.' },
        { status: 503 }
      )
    }
    return unauthorized()
  }

  const sp = request.nextUrl.searchParams
  const now = new Date()

  // ---- Optional "as of" date: cut every GL balance at that date ----
  // With ?asOf=YYYY-MM-DD, the accounts / trial_balance / bank book columns are
  // recomputed from posted JE lines through that date (via balancesAsOf) instead
  // of the live currentBalance — so you can read, e.g., the Dec 31 2025
  // shareholder-loan balance. Open invoices/bills and the recent-JE list still
  // reflect current state (see notes).
  const asOfActive = !!sp.get('asOf')
  const asOf = parseAsOfParam(sp.get('asOf') ?? undefined, now)

  // ---- Period for GST ----
  // Explicit ?start=&end= win. Otherwise, with ?asOf set the window follows it
  // (Jan 1 of asOf's year → asOf) so the GST summary matches the balance cut;
  // without asOf it defaults to calendar year-to-date. Note: asOf is LOCAL
  // end-of-day (parseAsOfParam), so its local year is the param's year.
  const gstWindowFromAsOf = asOfActive && !sp.get('start') && !sp.get('end')
  const start = sp.get('start')
    ? new Date(sp.get('start') as string)
    : new Date(Date.UTC(asOfActive ? asOf.getFullYear() : now.getUTCFullYear(), 0, 1))
  const end = sp.get('end')
    ? new Date(sp.get('end') as string)
    : asOfActive
      ? new Date(asOf.getTime())
      : new Date(now.getTime())
  end.setUTCHours(23, 59, 59, 999) // boundary dates are UTC calendar-date instants

  // ---- Pull everything read-only ----
  const gstAccount = await prisma.gLAccount.findFirst({
    where: { accountNumber: '2315' },
    select: { id: true },
  })

  const [
    accounts,
    bankAccounts,
    openInvoices,
    openBills,
    journalEntries,
    gstLines,
    periodLock,
  ] = await Promise.all([
      prisma.gLAccount.findMany({
        where: { isArchived: false },
        orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
        select: {
          id: true,
          accountNumber: true,
          accountName: true,
          accountClass: true,
          accountSubclass: true,
          currency: true,
          currentBalance: true,
          openingBalance: true,
          openingBalanceDate: true,
        },
      }),
      prisma.bankAccount.findMany({
        orderBy: { sortOrder: 'asc' },
        include: {
          glAccount: {
            select: {
              id: true,
              accountNumber: true,
              accountName: true,
              currency: true,
              currentBalance: true,
            },
          },
        },
      }),
      prisma.invoice.findMany({
        where: { status: { notIn: ['paid', 'draft', 'archived', 'void'] } },
        orderBy: { dateDue: 'asc' },
        take: 500,
        include: {
          client: {
            select: { firstName: true, lastName: true, organization: true },
          },
        },
      }),
      prisma.bill.findMany({
        where: {
          isArchived: false,
          status: { notIn: ['paid', 'draft', 'void'] },
        },
        orderBy: { dueDate: 'asc' },
        take: 500,
        include: { vendor: { select: { name: true } } },
      }),
      prisma.journalEntry.findMany({
        orderBy: { entryDate: 'desc' },
        take: 50,
        include: { _count: { select: { lines: true } } },
      }),
      gstAccount
        ? prisma.journalEntryLine.findMany({
            where: {
              glAccountId: gstAccount.id,
              journalEntry: {
                status: 'posted',
                entryDate: { gte: start, lte: end },
              },
            },
            select: { debit: true, credit: true },
          })
        : Promise.resolve([]),
      getPeriodLock(),
    ])

  // When ?asOf is set, recompute every GL balance from posted JE lines through
  // that date. balancesAsOf returns the natural-signed balance (positive on the
  // account's normal side) — same convention as currentBalance — so it drops in
  // wherever we read currentBalance. Without ?asOf, balOf returns currentBalance.
  const asOfBalances = asOfActive ? await balancesAsOf(accounts, asOf) : null
  const balOf = (a: { id: string; currentBalance: unknown }): number =>
    asOfBalances ? asOfBalances.get(a.id) ?? 0 : Number(a.currentBalance)

  // ---- Trial balance (across all currencies; every JE balances at face value) ----
  const tbRows = accounts
    .map((a) => {
      const bal = balOf(a)
      const debitNormal =
        a.accountClass === 'asset' || a.accountClass === 'expense'
      return {
        number: a.accountNumber,
        name: a.accountName,
        class: a.accountClass,
        currency: a.currency,
        debit: round2(debitNormal ? Math.max(0, bal) : Math.max(0, -bal)),
        credit: round2(debitNormal ? Math.max(0, -bal) : Math.max(0, bal)),
      }
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
  const totalDebit = round2(tbRows.reduce((s, r) => s + r.debit, 0))
  const totalCredit = round2(tbRows.reduce((s, r) => s + r.credit, 0))

  // ---- GST summary (single-account 2315 convention: credits collected, debits = ITCs) ----
  let collected = 0
  let paid = 0
  for (const l of gstLines) {
    collected += Number(l.credit || 0)
    paid += Number(l.debit || 0)
  }

  function clientName(c: { firstName: string; lastName: string; organization: string }) {
    return c.organization || `${c.firstName} ${c.lastName}`.trim() || 'No client'
  }

  return Response.json(
    {
      generatedAt: now.toISOString(),
      asOf: asOfActive ? asOf.toISOString().slice(0, 10) : null,
      notes:
        'GL accounts are single-currency at face value; each amount is in that account’s own currency. Trial balance nets to zero numerically across currencies because every journal entry balances at face value.' +
        (asOfActive
          ? ` Balances (accounts, trial_balance, bank book) are cut as of ${asOf
              .toISOString()
              .slice(0, 10)} from posted journal entries; open_invoices, open_bills and journal_entries still reflect current state.`
          : '') +
        (gstWindowFromAsOf
          ? ` gst_summary window defaulted from asOf (Jan 1 of that year through asOf); pass ?start=&end= to override.`
          : ''),
      accounts: accounts.map((a) => ({
        number: a.accountNumber,
        name: a.accountName,
        class: a.accountClass,
        subclass: a.accountSubclass,
        currency: a.currency,
        balance: round2(balOf(a)),
      })),
      trial_balance: {
        rows: tbRows,
        totalDebit,
        totalCredit,
        balanced: Math.abs(totalDebit - totalCredit) < 0.01,
      },
      bank_balances: bankAccounts.map((b) => {
        // As-of book balance pulls from the same map (the bank's GL account is in
        // `accounts`); falls back to currentBalance if not present or no asOf.
        const book = asOfBalances
          ? asOfBalances.get(b.glAccount.id) ?? Number(b.glAccount.currentBalance)
          : Number(b.glAccount.currentBalance)
        return {
          number: b.glAccount.accountNumber,
          name: b.glAccount.accountName,
          type: b.accountType,
          currency: b.glAccount.currency,
          book: round2(book),
          reconciled: round2(Number(b.reconciledBalance)),
          difference: round2(book - Number(b.reconciledBalance)),
          lastReconciledAt: b.lastReconciledAt?.toISOString() ?? null,
        }
      }),
      open_invoices: openInvoices.map((i) => ({
        invoiceNumber: i.invoiceNumber,
        client: clientName(i.client),
        status: i.status,
        currency: i.currency,
        dateIssued: i.dateIssued.toISOString().slice(0, 10),
        dateDue: i.dateDue.toISOString().slice(0, 10),
        total: round2(Number(i.total)),
        amountDue: round2(Number(i.amountDue)),
      })),
      open_bills: openBills.map((b) => ({
        billNumber: b.billNumber,
        vendor: b.vendor?.name ?? 'No vendor',
        status: b.status,
        currency: b.currency,
        dateIssued: b.billDate.toISOString().slice(0, 10),
        dateDue: b.dueDate.toISOString().slice(0, 10),
        total: round2(Number(b.total)),
        amountDue: round2(Number(b.amountDue)),
      })),
      period_lock: periodLock.lockedThrough
        ? periodLock.lockedThrough.toISOString().slice(0, 10)
        : null,
      journal_entries: journalEntries.map((j) => ({
        entryNumber: j.entryNumber,
        entryDate: j.entryDate.toISOString().slice(0, 10),
        description: j.description,
        status: j.status,
        totalDebit: round2(Number(j.totalDebit)),
        totalCredit: round2(Number(j.totalCredit)),
        lineCount: j._count.lines,
      })),
      gst_summary: {
        period: {
          start: start.toISOString().slice(0, 10),
          end: end.toISOString().slice(0, 10),
        },
        account: '2315',
        collected: round2(collected),
        itcs_paid: round2(paid),
        net_owing: round2(collected - paid),
        found: !!gstAccount,
      },
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
