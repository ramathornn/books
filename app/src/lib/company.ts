import { cache } from 'react'
import prisma from '@/lib/prisma'
import type { FiscalYearEnd } from '@/lib/fiscalYear'

export interface CompanyInfo {
  name: string
  legalName: string
  logoInitials: string
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
  phone: string
  email: string
  website: string
  defaultCurrency: string
  defaultPaymentTerms: string
  // T2 (corporate) identifiers.
  albertaCorporateAccountNumber: string
  t2ProgramAccount: string
  /** Fiscal year-end month + day (default Dec 31) — drives the fiscal report presets. */
  fiscalYearEnd: FiscalYearEnd
  // Convenience:
  addressSingleLine: string
  addressMultiLine: string[]
}

function buildAddressLines(row: {
  addressLine1: string
  addressLine2: string
  city: string
  province: string
  postalCode: string
  country: string
}): { addressSingleLine: string; addressMultiLine: string[] } {
  const parts: string[] = []

  if (row.addressLine1 && row.addressLine1.trim()) parts.push(row.addressLine1.trim())
  if (row.addressLine2 && row.addressLine2.trim()) parts.push(row.addressLine2.trim())

  // city + province + postalCode combined (space-separated, skipping empties)
  const cityLineParts: string[] = []
  if (row.city && row.city.trim()) cityLineParts.push(row.city.trim())
  const provincePostal = [row.province, row.postalCode]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ')
  if (provincePostal) cityLineParts.push(provincePostal)
  const cityLine = cityLineParts.join(' ')
  if (cityLine) parts.push(cityLine)

  if (row.country && row.country.trim()) parts.push(row.country.trim())

  return {
    addressSingleLine: parts.join(', '),
    addressMultiLine: parts,
  }
}

export const getCompanySettings = cache(async (): Promise<CompanyInfo> => {
  const row = await prisma.companySettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: { id: 'singleton' },
  })

  const { addressSingleLine, addressMultiLine } = buildAddressLines(row)

  return {
    name: row.name,
    legalName: row.legalName,
    logoInitials: row.logoInitials,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    province: row.province,
    postalCode: row.postalCode,
    country: row.country,
    phone: row.phone,
    email: row.email,
    website: row.website,
    defaultCurrency: row.defaultCurrency,
    defaultPaymentTerms: row.defaultPaymentTerms,
    albertaCorporateAccountNumber: row.albertaCorporateAccountNumber,
    t2ProgramAccount: row.t2ProgramAccount,
    fiscalYearEnd: { month: row.fiscalYearEndMonth, day: row.fiscalYearEndDay },
    addressSingleLine,
    addressMultiLine,
  }
})
