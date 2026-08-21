/**
 * Shared where-builder for the payments list — used by the table route
 * (paginated) and the export route (full result set).
 */

export function buildPaymentsWhere(
  sp: URLSearchParams
): Record<string, unknown> {
  const search = sp.get('search') || undefined
  const clientId = sp.get('clientId') || ''
  const paymentMethod = sp.get('paymentMethod') || ''
  const source = sp.get('source') || ''
  const dateFrom = sp.get('dateFrom') || ''
  const dateTo = sp.get('dateTo') || ''
  const amountMin = sp.get('amountMin') || ''
  const amountMax = sp.get('amountMax') || ''
  const currency = sp.get('currency') || ''
  const keyword = sp.get('keyword') || ''

  const andClauses: Record<string, unknown>[] = []

  if (search) {
    andClauses.push({
      OR: [
        { client: { firstName: { contains: search, mode: 'insensitive' } } },
        { client: { lastName: { contains: search, mode: 'insensitive' } } },
        { client: { organization: { contains: search, mode: 'insensitive' } } },
        { invoice: { invoiceNumber: { contains: search, mode: 'insensitive' } } },
      ],
    })
  }

  if (clientId) andClauses.push({ clientId })
  if (paymentMethod) andClauses.push({ paymentMethod })
  if (source) andClauses.push({ source })
  if (currency) andClauses.push({ currency })

  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {}
    if (dateFrom) range.gte = new Date(dateFrom)
    if (dateTo) range.lte = new Date(dateTo)
    andClauses.push({ paymentDate: range })
  }

  if (amountMin || amountMax) {
    const range: Record<string, number> = {}
    if (amountMin) range.gte = Number(amountMin)
    if (amountMax) range.lte = Number(amountMax)
    andClauses.push({ amount: range })
  }

  if (keyword) {
    andClauses.push({
      OR: [
        { notes: { contains: keyword, mode: 'insensitive' } },
        { stripePaymentIntentId: { contains: keyword, mode: 'insensitive' } },
      ],
    })
  }

  return andClauses.length > 0 ? { AND: andClauses } : {}
}

export function resolvePaymentSort(
  sp: URLSearchParams
): { sortBy: string; sortDir: 'asc' | 'desc' } {
  const sortBy = sp.get('sortBy') === 'amount' ? 'amount' : 'paymentDate'
  const sortDir = sp.get('sort') === 'asc' ? 'asc' : 'desc'
  return { sortBy, sortDir }
}
