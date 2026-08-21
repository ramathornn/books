/**
 * Shared where-builder for the estimates list — used by the table route
 * (paginated) and the export route (full result set).
 */

const VALID_STATUSES = new Set([
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
])

const VALID_CURRENCIES = new Set(['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'JPY'])

function parseDate(raw: string | null): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return undefined
  return d
}

function parseNumber(raw: string | null): number | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return n
}

export function buildEstimatesWhere(
  sp: URLSearchParams
): Record<string, unknown> {
  const search = sp.get('search') || undefined
  const statusParam = sp.get('status') || ''
  const clientIdParam = sp.get('clientId') || ''
  const currencyParam = sp.get('currency') || ''
  const dateIssuedFrom = parseDate(sp.get('dateIssuedFrom'))
  const dateIssuedTo = parseDate(sp.get('dateIssuedTo'))
  const amountMin = parseNumber(sp.get('amountMin'))
  const amountMax = parseNumber(sp.get('amountMax'))
  const keyword = sp.get('keyword') || ''

  const andClauses: Record<string, unknown>[] = []

  if (search) {
    andClauses.push({
      OR: [
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { client: { organization: { contains: search, mode: 'insensitive' } } },
        { estimateNumber: { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  if (keyword) {
    andClauses.push({
      OR: [
        { estimateNumber: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
        { notes: { contains: keyword, mode: 'insensitive' } },
      ],
    })
  }

  if (statusParam && VALID_STATUSES.has(statusParam)) {
    andClauses.push({ status: statusParam })
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

  if (amountMin !== undefined || amountMax !== undefined) {
    const range: Record<string, number> = {}
    if (amountMin !== undefined) range.gte = amountMin
    if (amountMax !== undefined) range.lte = amountMax
    andClauses.push({ total: range })
  }

  return andClauses.length > 0 ? { AND: andClauses } : {}
}

export function resolveEstimateSort(
  sp: URLSearchParams
): { orderBy: Record<string, 'asc' | 'desc'>; sortBy: string; sortDir: 'asc' | 'desc' } {
  const sortBy =
    sp.get('sortBy') === 'amount'
      ? 'amount'
      : sp.get('sortBy') === 'client'
        ? 'client'
        : 'date'
  const sortDir = sp.get('sort') === 'asc' ? 'asc' : 'desc'

  let orderBy: Record<string, 'asc' | 'desc'> = { dateIssued: sortDir }
  if (sortBy === 'amount') orderBy = { total: sortDir }
  else if (sortBy === 'client') orderBy = { estimateNumber: sortDir }

  return { orderBy, sortBy, sortDir }
}
