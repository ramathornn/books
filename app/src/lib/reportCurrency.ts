import prisma from '@/lib/prisma'

export const SUPPORTED_CURRENCIES = ['CAD', 'USD', 'EUR'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

/**
 * Reads `currency` from parsed searchParams. Validates against supported list;
 * returns `undefined` if absent/invalid so callers can fall back to a data-derived default.
 */
export function parseCurrencyParam(
  p: { [k: string]: string | string[] | undefined }
): string | undefined {
  const raw = typeof p.currency === 'string' ? p.currency.toUpperCase() : undefined
  if (!raw) return undefined
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(raw) ? raw : undefined
}

async function mostCommonBy<T extends { _count: { _all: number } }>(
  groups: T[]
): Promise<T | undefined> {
  return groups.sort((a, b) => b._count._all - a._count._all)[0]
}

/** Most frequent invoice currency; falls back to 'CAD'. */
export async function defaultInvoiceCurrency(): Promise<string> {
  const groups = await prisma.invoice.groupBy({
    by: ['currency'],
    _count: { _all: true },
  })
  const top = await mostCommonBy(groups)
  return top?.currency || 'CAD'
}

/** Most frequent payment currency; falls back to 'CAD'. */
export async function defaultPaymentCurrency(): Promise<string> {
  const groups = await prisma.payment.groupBy({
    by: ['currency'],
    _count: { _all: true },
  })
  const top = await mostCommonBy(groups)
  return top?.currency || 'CAD'
}

/** Most frequent expense currency; falls back to 'CAD'. */
export async function defaultExpenseCurrency(): Promise<string> {
  const groups = await prisma.expense.groupBy({
    by: ['currency'],
    _count: { _all: true },
  })
  const top = await mostCommonBy(groups)
  return top?.currency || 'CAD'
}

/** Most frequent time entry currency; falls back to 'CAD'. */
export async function defaultTimeEntryCurrency(): Promise<string> {
  const groups = await prisma.timeEntry.groupBy({
    by: ['currency'],
    _count: { _all: true },
  })
  const top = await mostCommonBy(groups)
  return top?.currency || 'CAD'
}

/** Most frequent GL account currency; falls back to 'CAD'. */
export async function defaultGLAccountCurrency(): Promise<string> {
  const groups = await prisma.gLAccount.groupBy({
    by: ['currency'],
    _count: { _all: true },
  })
  const top = await mostCommonBy(groups)
  return top?.currency || 'CAD'
}
