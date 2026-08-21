import { Prisma } from '@/generated/prisma/client'
import crypto from 'crypto'

type Decimal = Prisma.Decimal

/**
 * Format a monetary amount with currency symbol and currency code suffix.
 * Negative amounts render as -$250.00 (not $-250.00).
 * Examples: "$2,070.00 CAD", "-$250.00 USD", "€1,500.00 EUR"
 */
export function formatCurrency(
  amount: number | Decimal,
  currency: string,
  opts?: { includeCode?: boolean; decimals?: number }
): string {
  const num = typeof amount === 'number' ? amount : Number(amount)

  const symbolMap: Record<string, string> = {
    CAD: '$',
    USD: '$',
    EUR: '\u20ac',
    GBP: '\u00a3',
  }

  const symbol = symbolMap[currency.toUpperCase()] || '$'
  const includeCode = opts?.includeCode ?? true
  const decimals = opts?.decimals ?? 2

  const formatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  const prefix = num < 0 ? '-' : ''
  return includeCode
    ? `${prefix}${symbol}${formatted} ${currency}`
    : `${prefix}${symbol}${formatted}`
}

/**
 * Format a number without currency symbol (plain number with commas).
 * Used for subtotals, tax, total, amount paid lines in totals block.
 * Examples: "2,070.00", "103.50", "0.00"
 */
export function formatPlainNumber(amount: number | Decimal): string {
  const num = typeof amount === 'number' ? amount : Number(amount)
  const formatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const prefix = num < 0 ? '-' : ''
  return `${prefix}${formatted}`
}

/**
 * Format a number as a 7-digit zero-padded invoice/estimate number.
 * Example: 1 -> "0000001", 45 -> "0000045"
 */
export function formatInvoiceNumber(num: number): string {
  return num.toString().padStart(7, '0')
}

/**
 * Parse a formatted money string into a number.
 * Handles: "$1,234.56", "€250.00", "-$100.00", "$2,070.00", "−$250.00"
 */
export function parseAmount(str: string): number {
  if (!str || str.trim() === '') return 0

  const cleaned = str.trim()

  // Detect negative: leading "-" or "−" (unicode minus)
  const isNegative = cleaned.startsWith('-') || cleaned.startsWith('\u2212')

  // Remove currency symbols, commas, spaces, currency codes, and sign characters
  const numStr = cleaned
    .replace(/[−\-]/g, '')
    .replace(/[$€£¥]/g, '')
    .replace(/,/g, '')
    .replace(/\s*(CAD|USD|EUR|GBP)\s*/gi, '')
    .trim()

  const num = parseFloat(numStr)

  if (isNaN(num)) return 0

  return isNegative ? -num : num
}

/**
 * Generate a unique share token for invoices/estimates.
 * Returns a 32-character hex string.
 */
export function generateShareToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * Get a Tailwind color class for an invoice/estimate status.
 */
export function getStatusColor(status: string): string {
  const statusMap: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-800',
    sent: 'bg-blue-100 text-blue-800',
    viewed: 'bg-yellow-100 text-yellow-800',
    paid: 'bg-green-100 text-green-800',
    partial: 'bg-orange-100 text-orange-800',
    overdue: 'bg-red-100 text-red-800',
    accepted: 'bg-green-100 text-green-800',
    declined: 'bg-red-100 text-red-800',
    invoiced: 'bg-purple-100 text-purple-800',
    cancelled: 'bg-gray-100 text-gray-500',
  }

  return statusMap[status.toLowerCase()] || 'bg-gray-100 text-gray-800'
}

/**
 * Format a Date or ISO date string into MM/DD/YYYY format.
 * Example: "2026-04-13" -> "04/13/2026"
 */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return ''

  const d = typeof date === 'string' ? new Date(date) : date

  if (isNaN(d.getTime())) return ''

  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  const year = d.getUTCFullYear()

  return `${month}/${day}/${year}`
}

/**
 * Format a Date or ISO date string into "MMM D, YYYY" format for relative contexts.
 * Example: "2026-04-13" -> "Apr 13, 2026"
 */
export function formatDateLong(date: Date | string | null | undefined): string {
  if (!date) return ''

  const d = typeof date === 'string' ? new Date(date) : date

  if (isNaN(d.getTime())) return ''

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[d.getUTCMonth()]
  const day = d.getUTCDate()
  const year = d.getUTCFullYear()

  return `${month} ${day}, ${year}`
}

/**
 * Parse a date string in "MM/DD/YYYY" format into a Date object.
 * Returns a Date at midnight UTC.
 */
export function parseDateString(dateStr: string): Date {
  if (!dateStr || dateStr.trim() === '') return new Date()

  const parts = dateStr.trim().split('/')
  if (parts.length !== 3) return new Date(dateStr)

  const month = parseInt(parts[0], 10)
  const day = parseInt(parts[1], 10)
  const year = parseInt(parts[2], 10)

  return new Date(Date.UTC(year, month - 1, day))
}

/**
 * Get the base URL for the application (for share links, etc.).
 * Uses NEXTAUTH_URL env var, falls back to http://localhost:3000 for local dev.
 */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}

const COUNTRY_LINES = new Set([
  'canada', 'united states', 'usa', 'us', 'united kingdom', 'uk', 'germany', 'france',
  'spain', 'italy', 'netherlands', 'belgium', 'austria', 'ireland', 'portugal',
  'sweden', 'norway', 'denmark', 'finland', 'switzerland', 'australia', 'new zealand',
  'mexico', 'brazil', 'argentina', 'japan', 'singapore', 'united arab emirates', 'uae',
])

export function stripCountryFromAddress(address: string | null | undefined): string {
  if (!address) return ''
  return address
    .split('\n')
    .filter((line) => !COUNTRY_LINES.has(line.trim().toLowerCase()))
    .join('\n')
}
