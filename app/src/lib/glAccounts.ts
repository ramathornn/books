import prisma from '@/lib/prisma'

/**
 * Resolve the Accounts Receivable control account.
 * Lowest account number among A/R accounts wins.
 */
export async function findArAccount() {
  return prisma.gLAccount.findFirst({
    where: { accountSubclass: 'Accounts Receivable' },
    orderBy: { accountNumber: 'asc' },
  })
}

/**
 * Resolve the default Sales / income account that accrued revenue credits.
 * CompanySettings.defaultSalesAccountId wins; otherwise the first income
 * account that is not "Other Income", ordered by account number.
 */
export async function findSalesAccount() {
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  if (settings?.defaultSalesAccountId) {
    const acct = await prisma.gLAccount.findUnique({ where: { id: settings.defaultSalesAccountId } })
    if (acct) return acct
  }
  return prisma.gLAccount.findFirst({
    where: {
      accountClass: 'income',
      NOT: { detailType: 'Other Income' },
    },
    orderBy: { accountNumber: 'asc' },
  })
}

/**
 * Resolve the GST/HST Payable account (tax collected on sales).
 * CompanySettings.defaultGstPayableAccountId wins; otherwise account number 2315.
 */
export async function findGstPayableAccount() {
  const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
  if (settings?.defaultGstPayableAccountId) {
    const acct = await prisma.gLAccount.findUnique({ where: { id: settings.defaultGstPayableAccountId } })
    if (acct) return acct
  }
  return prisma.gLAccount.findFirst({ where: { accountNumber: '2315' } })
}

/**
 * Resolve the Bad Debt expense account (used when writing off uncollectible
 * A/R). Matches an expense account named like "Bad Debt(s)" by account name or
 * subclass; lowest account number wins. Returns null if none is configured —
 * callers should error clearly.
 */
export async function findBadDebtAccount() {
  return prisma.gLAccount.findFirst({
    where: {
      accountClass: 'expense',
      OR: [
        { accountName: { contains: 'Bad Debt', mode: 'insensitive' } },
        { accountSubclass: { contains: 'Bad Debt', mode: 'insensitive' } },
      ],
    },
    orderBy: { accountNumber: 'asc' },
  })
}

/**
 * Resolve the ITC receivable account for a given tax code (tax recoverable on
 * purchases). Uses the tax code's configured receivableAccountId.
 */
export async function findItcAccount(taxCode: { receivableAccountId?: string | null } | null | undefined) {
  if (!taxCode?.receivableAccountId) return null
  return prisma.gLAccount.findUnique({ where: { id: taxCode.receivableAccountId } })
}
