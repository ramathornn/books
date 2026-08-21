/**
 * Shared where-builder for the invoices list — used by the table route
 * (paginated) and the export route (full result set).
 */

const VALID_STATUSES = new Set([
  'draft',
  'sent',
  'viewed',
  'partial',
  'paid',
  'overdue',
])

const VALID_CURRENCIES = new Set(['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'JPY'])

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

// Invoice dates are stored at UTC midnight, so compare against today's UTC date
// to decide whether an invoice has tipped into "overdue".
function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
}

function parseNumber(raw: string | null): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return n
}

export function buildInvoicesWhere(
  sp: URLSearchParams
): Record<string, unknown> {
  const search = sp.get('search') || undefined
  const statusParam = sp.get('status') || ''
  const clientIdParam = sp.get('clientId') || ''
  const currencyParam = sp.get('currency') || ''
  const dateIssuedFrom = parseDate(sp.get('dateIssuedFrom'))
  const dateIssuedTo = parseDate(sp.get('dateIssuedTo'))
  const dateDueFrom = parseDate(sp.get('dateDueFrom'))
  const dateDueTo = parseDate(sp.get('dateDueTo'))
  const amountMin = parseNumber(sp.get('amountMin'))
  const amountMax = parseNumber(sp.get('amountMax'))
  const keyword = sp.get('keyword') || ''

  const andClauses: Record<string, unknown>[] = []

  if (search) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { client: { organization: { contains: search, mode: 'insensitive' } } },
        { description: { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  if (keyword) {
    andClauses.push({
      OR: [
        { invoiceNumber: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { notes: { contains: keyword, mode: 'insensitive' } },
        { reference: { contains: keyword, mode: 'insensitive' } },
      ],
    })
  }

  // Status is multi-select (comma-separated) and matches the *effective* status
  // shown on the badges: "overdue" is derived (unpaid + past due), not a stored
  // value, and sent/viewed/partial only count while not yet past due.
  const statuses = statusParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID_STATUSES.has(s))
  if (statuses.length > 0) {
    const today = startOfTodayUTC()
    const statusOr: Record<string, unknown>[] = statuses.map((s) => {
      if (s === 'overdue') {
        return {
          status: { notIn: ['paid', 'draft', 'archived', 'refunded'] },
          dateDue: { lt: today },
        }
      }
      if (s === 'paid' || s === 'draft') {
        return { status: s }
      }
      // sent / viewed / partial — only before they tip into "overdue"
      return { status: s, dateDue: { gte: today } }
    })
    andClauses.push(statusOr.length === 1 ? statusOr[0] : { OR: statusOr })
  }

  if (clientIdParam) {
    andClauses.push({ clientId: clientIdParam })
  }

  if (currencyParam && VALID_CURRENCIES.has(currencyParam)) {
    andClauses.push({ currency: currencyParam })
  }

  if (dateIssuedFrom || dateIssuedTo) {
    const range: Record<string, Date> = {}
    if (dateIssuedFrom) range.gte = dateIssuedFrom
    if (dateIssuedTo) range.lte = dateIssuedTo
    andClauses.push({ dateIssued: range })
  }

  if (dateDueFrom || dateDueTo) {
    const range: Record<string, Date> = {}
    if (dateDueFrom) range.gte = dateDueFrom
    if (dateDueTo) range.lte = dateDueTo
    andClauses.push({ dateDue: range })
  }

  if (amountMin !== undefined || amountMax !== undefined) {
    const range: Record<string, number> = {}
    if (amountMin !== undefined) range.gte = amountMin
    if (amountMax !== undefined) range.lte = amountMax
    andClauses.push({ total: range })
  }

  return andClauses.length > 0 ? { AND: andClauses } : {}
}

export function resolveInvoiceSort(
  sp: URLSearchParams
): { sortBy: string; sortDir: 'asc' | 'desc' } {
  const sortByRaw = sp.get('sortBy') || 'dateIssued'
  const sortBy = ['dateIssued', 'dateDue', 'total', 'invoiceNumber'].includes(
    sortByRaw
  )
    ? sortByRaw
    : 'dateIssued'
  const sortDir = sp.get('sort') === 'asc' ? 'asc' : 'desc'
  return { sortBy, sortDir }
}
