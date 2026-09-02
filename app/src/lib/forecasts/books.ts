// Derives forecast rows from Books. Everything here is read-only over Books
// tables and is rebuilt on every scenario load, so the forecast can never
// drift from the accounting side. All amounts are CAD.
import 'server-only'
import prisma from '@/lib/prisma'
import { getCadRate } from '@/lib/fx'
import { advanceDate, type IntervalUnit } from '@/lib/recurring'
import { balancesAsOf } from '@/lib/glBalances'
import type { BookEvent, CellValue, LinkedInfo } from './types'
import { daysInMonth, parseMonthLabel } from './months'

export interface BooksRow {
  section: 'income' | 'expenses'
  name: string
  /** Expense rows: virtual category header they sit under ("Bills", "Recurring", "Spend by category"). */
  category?: string
  cells: CellValue[]
  linked: LinkedInfo
}

export interface BooksDerived {
  rows: BooksRow[]
  events: BookEvent[]
}

const ACTIVE_WINDOW_MONTHS = 2 // invoiced this month or last month
const TRAILING_MONTHS = 3 // run-rate window for projecting categorized spend
const DEFAULT_DAYS_TO_PAY = 30

const r2 = (n: number) => Math.round(n * 100) / 100
const toISO = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const monthKey = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()

interface MonthGrid {
  labels: string[]
  firstKey: number // year*12+month of index 0
  todayIdx: number
  todayKey: number
}

function grid(months: string[], now: Date): MonthGrid {
  const first = parseMonthLabel(months[0])!
  const firstKey = first.year * 12 + first.month
  const todayKey = now.getFullYear() * 12 + now.getMonth()
  return { labels: months, firstKey, todayIdx: todayKey - firstKey, todayKey }
}

const idxOf = (g: MonthGrid, d: Date): number => monthKey(d) - g.firstKey
const inRange = (g: MonthGrid, i: number) => i >= 0 && i < g.labels.length
const dateInMonth = (g: MonthGrid, i: number, day: number): Date => {
  const p = parseMonthLabel(g.labels[i])!
  return new Date(Date.UTC(p.year, p.month, Math.min(day, daysInMonth(p))))
}

/** Rate cache: currency + month → CAD per unit. */
async function rateFor(cache: Map<string, number>, currency: string, date: Date): Promise<number> {
  if (currency === 'CAD') return 1
  const key = `${currency}:${date.getUTCFullYear()}-${date.getUTCMonth()}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let rate = 1
  try { rate = (await getCadRate(currency, date)).rate } catch { /* identity */ }
  cache.set(key, rate)
  return rate
}

// ─── Income: one row per active client ───────────────────────────────────

export async function buildBooksIncome(months: string[], now = new Date()): Promise<BooksDerived> {
  const g = grid(months, now)
  const rates = new Map<string, number>()
  const rows: BooksRow[] = []
  const events: BookEvent[] = []
  const rangeStart = dateInMonth(g, 0, 1)
  const rangeEnd = new Date(Date.UTC(parseMonthLabel(g.labels[g.labels.length - 1])!.year, parseMonthLabel(g.labels[g.labels.length - 1])!.month + 1, 1))

  // Active clients: invoiced (any non-void invoice issued) this month or last.
  const activeSince = new Date(Date.UTC(now.getFullYear(), now.getMonth() - (ACTIVE_WINDOW_MONTHS - 1), 1))
  const active = await prisma.invoice.findMany({
    where: { dateIssued: { gte: activeSince }, status: { notIn: ['void', 'archived'] } },
    select: { clientId: true },
    distinct: ['clientId'],
  })
  const clientIds = active.map((a) => a.clientId)
  if (!clientIds.length) return { rows, events }

  const clients = await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, firstName: true, lastName: true, organization: true } })
  const nameOf = (c: (typeof clients)[number]) => c.organization || `${c.firstName} ${c.lastName}`.trim() || 'Client'

  // Days-to-pay per client from paid history (payment date − issue date), capped to something sane.
  const history = await prisma.payment.findMany({
    where: { clientId: { in: clientIds }, status: 'paid' },
    select: { clientId: true, paymentDate: true, invoice: { select: { dateIssued: true } } },
    orderBy: { paymentDate: 'desc' },
    take: 500,
  })
  const dtp = new Map<string, number[]>()
  for (const p of history) {
    const days = (p.paymentDate.getTime() - p.invoice.dateIssued.getTime()) / 86400000
    if (days >= 0 && days <= 180) (dtp.get(p.clientId) ?? dtp.set(p.clientId, []).get(p.clientId)!).push(days)
  }
  const daysToPay = (clientId: string) => {
    const arr = (dtp.get(clientId) ?? []).slice(0, 12)
    return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null
  }

  // Collected: payments in range → actuals on payment date.
  const payments = await prisma.payment.findMany({
    where: { clientId: { in: clientIds }, status: 'paid', paymentDate: { gte: rangeStart, lt: rangeEnd } },
    select: { id: true, clientId: true, paymentDate: true, amount: true, currency: true, cadAmount: true, fxRate: true, invoice: { select: { invoiceNumber: true } } },
  })
  // Outstanding + drafts → expected on issue date + days-to-pay (fallback: due date).
  const open = await prisma.invoice.findMany({
    where: { clientId: { in: clientIds }, status: { in: ['draft', 'sent', 'viewed', 'partial', 'overdue'] } },
    select: { id: true, clientId: true, invoiceNumber: true, status: true, dateIssued: true, dateDue: true, currency: true, total: true, amountPaid: true, cadTotal: true, fxRate: true },
  })

  const perClient = new Map<string, { cells: number[]; client: (typeof clients)[number] }>()
  for (const c of clients) perClient.set(c.id, { cells: new Array(g.labels.length).fill(0), client: c })
  const add = (clientId: string, date: Date, amount: number, kind: BookEvent['kind'], label: string, refId: string) => {
    const entry = perClient.get(clientId)
    if (!entry) return
    const i = idxOf(g, date)
    if (!inRange(g, i)) return
    entry.cells[i] = r2(entry.cells[i] + amount)
    events.push({ date: toISO(date), monthIndex: i, section: 'income', row: nameOf(entry.client), amount: r2(amount), kind, label, refId })
  }

  for (const p of payments) {
    const cad = p.cadAmount !== null ? Number(p.cadAmount) : Number(p.amount) * (p.fxRate !== null ? Number(p.fxRate) : await rateFor(rates, p.currency, p.paymentDate))
    add(p.clientId, p.paymentDate, cad, 'collected', `Payment on #${p.invoice.invoiceNumber}`, p.id)
  }
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  for (const inv of open) {
    const remaining = Number(inv.total) - Number(inv.amountPaid)
    if (remaining <= 0) continue
    const rate = inv.cadTotal !== null && Number(inv.total) > 0 ? Number(inv.cadTotal) / Number(inv.total) : inv.fxRate !== null ? Number(inv.fxRate) : await rateFor(rates, inv.currency, inv.dateIssued)
    const cad = remaining * rate
    const dtpDays = daysToPay(inv.clientId)
    let expected = dtpDays !== null ? new Date(inv.dateIssued.getTime() + dtpDays * 86400000) : inv.dateDue
    if (expected < today) expected = today // overdue: assume it lands soon, never in the past
    const isDraft = inv.status === 'draft'
    add(inv.clientId, expected, cad, isDraft ? 'draft' : 'expected', `${isDraft ? 'Draft' : 'Invoice'} #${inv.invoiceNumber}${dtpDays !== null ? ` (avg ${dtpDays}d to pay)` : ' (due date)'}`, inv.id)
  }

  // Recurring invoice templates → projected on each future run date.
  const templates = await prisma.recurringTemplate.findMany({ where: { isActive: true, transactionType: 'invoice', nextRunDate: { not: null } } })
  for (const t of templates) {
    const payload = (t.payload as { clientId?: string; currency?: string; lineItems?: { rate?: number; quantity?: number }[] }) || {}
    if (!payload.clientId || !perClient.has(payload.clientId)) continue
    const total = (payload.lineItems ?? []).reduce((s, li) => s + (Number(li.rate) || 0) * (Number(li.quantity) || 0), 0)
    if (total <= 0) continue
    const rate = await rateFor(rates, payload.currency || 'CAD', now)
    const dtpDays = daysToPay(payload.clientId) ?? DEFAULT_DAYS_TO_PAY
    let run = new Date(t.nextRunDate!)
    let guard = 0
    while (run < rangeEnd && guard++ < 120) {
      if (!t.endDate || run <= t.endDate) {
        const expected = new Date(run.getTime() + dtpDays * 86400000)
        add(payload.clientId, expected, total * rate, 'recurring', `Recurring: ${t.templateName}`, t.id)
      }
      run = advanceDate(run, t.intervalUnit as IntervalUnit, t.intervalCount)
    }
  }

  for (const [, { cells, client }] of perClient) {
    rows.push({ section: 'income', name: nameOf(client), cells, linked: { source: 'client', refId: client.id, note: `Active client · avg ${daysToPay(client.id) ?? DEFAULT_DAYS_TO_PAY} days to pay` } })
  }
  rows.sort((a, b) => a.name.localeCompare(b.name))
  return { rows, events }
}

// ─── Expenses: bills by vendor, recurring, categorized spend run-rate ─────

export const BOOKS_EXPENSE_CATEGORIES = { bills: 'Bills (Books)', recurring: 'Recurring (Books)', spend: 'Spend by category (Books)' } as const

export async function buildBooksExpenses(months: string[], now = new Date()): Promise<BooksDerived> {
  const g = grid(months, now)
  const rates = new Map<string, number>()
  const rows: BooksRow[] = []
  const events: BookEvent[] = []
  const last = parseMonthLabel(g.labels[g.labels.length - 1])!
  const rangeStart = dateInMonth(g, 0, 1)
  const rangeEnd = new Date(Date.UTC(last.year, last.month + 1, 1))
  const rowMap = new Map<string, BooksRow>()
  const rowFor = (category: string, name: string, linked: LinkedInfo) => {
    const key = `${category}/${name}`
    let r = rowMap.get(key)
    if (!r) { r = { section: 'expenses', name, category, cells: new Array(g.labels.length).fill(0), linked }; rowMap.set(key, r) }
    return r
  }
  const add = (r: BooksRow, date: Date, amount: number, kind: BookEvent['kind'], label: string, refId?: string) => {
    const i = idxOf(g, date)
    if (!inRange(g, i)) return
    r.cells[i] = r2((r.cells[i] as number) + amount)
    events.push({ date: toISO(date), monthIndex: i, section: 'expenses', row: r.name, amount: r2(amount), kind, label, refId })
  }

  // 1. Open bills → amount due on due date (never in the past).
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const bills = await prisma.bill.findMany({
    where: { isArchived: false, status: { in: ['open', 'partial'] } },
    select: { id: true, billNumber: true, dueDate: true, currency: true, amountDue: true, vendor: { select: { name: true, displayName: true } } },
  })
  for (const b of bills) {
    const due = Number(b.amountDue)
    if (due <= 0) continue
    const r = rowFor(BOOKS_EXPENSE_CATEGORIES.bills, b.vendor?.displayName || b.vendor?.name || 'Unassigned vendor', { source: 'bill', note: 'Open bills by due date' })
    add(r, b.dueDate < today ? today : b.dueDate, due * (await rateFor(rates, b.currency, b.dueDate)), 'bill', `Bill ${b.billNumber}`, b.id)
  }

  // 2. Recurring templates (expense + bill) → projected on run dates.
  const templates = await prisma.recurringTemplate.findMany({ where: { isActive: true, transactionType: { in: ['expense', 'bill'] }, nextRunDate: { not: null } } })
  for (const t of templates) {
    const p = (t.payload as { amount?: number; taxAmount?: number; currency?: string; lines?: { amount: number; taxAmount?: number }[]; daysUntilDue?: number }) || {}
    const total = t.transactionType === 'expense' ? (Number(p.amount) || 0) + (Number(p.taxAmount) || 0) : (p.lines ?? []).reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.taxAmount) || 0), 0)
    if (total <= 0) continue
    const r = rowFor(BOOKS_EXPENSE_CATEGORIES.recurring, t.templateName, { source: 'recurring', refId: t.id, note: 'Recurring template' })
    const rate = await rateFor(rates, p.currency || 'CAD', now)
    let run = new Date(t.nextRunDate!)
    let guard = 0
    while (run < rangeEnd && guard++ < 120) {
      if (!t.endDate || run <= t.endDate) {
        const lands = t.transactionType === 'bill' ? new Date(run.getTime() + (Number(p.daysUntilDue) || 0) * 86400000) : run
        add(r, lands, total * rate, 'recurring', `Recurring: ${t.templateName}`, t.id)
      }
      run = advanceDate(run, t.intervalUnit as IntervalUnit, t.intervalCount)
    }
  }
  // Expense records flagged recurring (Books' simpler recurring flag) → repeat forward from last occurrence.
  const flagged = await prisma.expense.findMany({
    where: { isArchived: false, isRecurring: true, recurringFrequency: { in: ['weekly', 'monthly', 'quarterly', 'annually', 'yearly'] } },
    select: { id: true, description: true, date: true, total: true, currency: true, recurringFrequency: true, recurringEndDate: true, category: { select: { name: true } }, vendor: { select: { name: true, displayName: true } } },
  })
  for (const e of flagged) {
    const unit: IntervalUnit = e.recurringFrequency === 'weekly' ? 'week' : e.recurringFrequency === 'quarterly' ? 'quarter' : e.recurringFrequency === 'monthly' ? 'month' : 'year'
    const label = e.vendor?.displayName || e.vendor?.name || e.description || e.category.name
    const r = rowFor(BOOKS_EXPENSE_CATEGORIES.recurring, label, { source: 'recurring', refId: e.id, note: `Recurring expense (${e.recurringFrequency})` })
    const amt = Number(e.total) * (await rateFor(rates, e.currency, e.date))
    let run = advanceDate(new Date(e.date), unit, 1)
    let guard = 0
    while (run < rangeEnd && guard++ < 120) {
      if (run >= today && (!e.recurringEndDate || run <= e.recurringEndDate)) add(r, run, amt, 'recurring', `Recurring: ${label}`, e.id)
      run = advanceDate(run, unit, 1)
    }
  }

  // 3. Categorized spend: actuals by expense category in range; future months at trailing average.
  const trailingStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - TRAILING_MONTHS, 1))
  const expenses = await prisma.expense.findMany({
    where: { isArchived: false, isReceiptDraft: false, isRecurring: false, date: { gte: trailingStart < rangeStart ? trailingStart : rangeStart, lt: rangeEnd } },
    select: { id: true, date: true, total: true, currency: true, description: true, category: { select: { id: true, name: true } } },
  })
  const trailing = new Map<string, { name: string; sum: number }>()
  const thisMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  for (const e of expenses) {
    const cad = Number(e.total) * (await rateFor(rates, e.currency, e.date))
    const r = rowFor(BOOKS_EXPENSE_CATEGORIES.spend, e.category.name, { source: 'spend', refId: e.category.id, note: `Actuals to date; future months at ${TRAILING_MONTHS}-month average` })
    if (e.date < thisMonthStart || e.date >= today) add(r, e.date, cad, 'spend', e.description || e.category.name, e.id)
    else add(r, e.date, cad, 'spend', e.description || e.category.name, e.id)
    if (e.date >= trailingStart && e.date < thisMonthStart) {
      const t = trailing.get(e.category.id) ?? { name: e.category.name, sum: 0 }
      t.sum += cad
      trailing.set(e.category.id, t)
    }
  }
  // Project the run-rate into every future month (landing mid-month) for categories with history.
  for (const [catId, t] of trailing) {
    const avg = r2(t.sum / TRAILING_MONTHS)
    if (avg <= 0) continue
    const r = rowFor(BOOKS_EXPENSE_CATEGORIES.spend, t.name, { source: 'spend', refId: catId, note: `Actuals to date; future months at ${TRAILING_MONTHS}-month average` })
    for (let i = g.todayIdx + 1; i < g.labels.length; i++) add(r, dateInMonth(g, i, 15), avg, 'spend', `${t.name} (run rate)`)
  }

  for (const r of rowMap.values()) rows.push(r)
  const order = [BOOKS_EXPENSE_CATEGORIES.bills, BOOKS_EXPENSE_CATEGORIES.recurring, BOOKS_EXPENSE_CATEGORIES.spend] as string[]
  rows.sort((a, b) => order.indexOf(a.category!) - order.indexOf(b.category!) || a.name.localeCompare(b.name))
  return { rows, events }
}

// ─── Cash on hand from Books banking ─────────────────────────────────────

export async function booksCashAsOf(asOf: Date): Promise<{ total: number; accounts: { id: string; name: string; balance: number }[] }> {
  const accounts = await prisma.bankAccount.findMany({
    where: { isArchived: false, accountType: { in: ['checking', 'savings', 'cash', 'wallet'] } },
    include: { glAccount: { select: { id: true, accountClass: true, openingBalance: true, openingBalanceDate: true } } },
    orderBy: { sortOrder: 'asc' },
  })
  const balances = await balancesAsOf(accounts.map((a) => a.glAccount), asOf)
  const items = accounts.map((a) => ({ id: a.id, name: `${a.bankName}${a.accountNumberMasked ? ` ${a.accountNumberMasked}` : ''}`, balance: r2(balances.get(a.glAccount.id) ?? 0) }))
  return { total: r2(items.reduce((s, i) => s + i.balance, 0)), accounts: items }
}

// ─── Personal "From Business": owner compensation out of Books' GL ───────

export async function buildOwnerPay(glAccountIds: string[], months: string[], now = new Date()): Promise<BooksDerived> {
  const g = grid(months, now)
  const rows: BooksRow[] = []
  const events: BookEvent[] = []
  if (!glAccountIds.length) return { rows, events }
  const rangeStart = dateInMonth(g, 0, 1)
  const trailingStart = new Date(Date.UTC(now.getFullYear(), now.getMonth() - TRAILING_MONTHS, 1))
  const lines = await prisma.journalEntryLine.findMany({
    where: { glAccountId: { in: glAccountIds }, journalEntry: { status: 'posted', entryDate: { gte: trailingStart < rangeStart ? trailingStart : rangeStart } } },
    select: { debit: true, credit: true, journalEntry: { select: { id: true, entryDate: true, description: true } } },
  })
  const row: BooksRow = { section: 'income', name: 'From Business', cells: new Array(g.labels.length).fill(0), linked: { source: 'owner-pay', note: `Posted owner pay in Books; future months at ${TRAILING_MONTHS}-month average` } }
  const thisMonthStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  let trailing = 0
  for (const l of lines) {
    const amt = Math.abs(Number(l.debit) - Number(l.credit))
    const d = l.journalEntry.entryDate
    const i = idxOf(g, d)
    if (inRange(g, i)) {
      row.cells[i] = r2((row.cells[i] as number) + amt)
      events.push({ date: toISO(d), monthIndex: i, section: 'income', row: row.name, amount: r2(amt), kind: 'owner-pay', label: l.journalEntry.description || 'Owner pay', refId: l.journalEntry.id })
    }
    if (d >= trailingStart && d < thisMonthStart) trailing += amt
  }
  const avg = r2(trailing / TRAILING_MONTHS)
  if (avg > 0) {
    for (let i = g.todayIdx + 1; i < g.labels.length; i++) {
      row.cells[i] = avg
      events.push({ date: toISO(dateInMonth(g, i, 28)), monthIndex: i, section: 'income', row: row.name, amount: avg, kind: 'owner-pay', label: 'From Business (run rate)' })
    }
  }
  rows.push(row)
  return { rows, events }
}
