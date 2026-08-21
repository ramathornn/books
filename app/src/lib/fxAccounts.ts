import prisma from '@/lib/prisma'

/**
 * Resolve the realized Foreign Exchange Gain/Loss GL account.
 *
 * Resolution order:
 *   1) explicit `overrideId` (caller picked one in the UI)
 *   2) CompanySettings.realizedFxAccountId
 *   3) account number 499
 *
 * 499 is income/credit-normal: realized FX gains CREDIT, losses DEBIT.
 * When `requireIncome` (the default), the resolved account MUST have
 * accountClass === 'income'. There is NO 6651 fallback — if the resolved
 * account is missing or not income, this throws loudly.
 */
export async function findRealizedFxAccount(
  overrideId?: string,
  opts: { requireIncome?: boolean } = {}
) {
  const requireIncome = opts.requireIncome ?? true

  let acct = null as Awaited<ReturnType<typeof prisma.gLAccount.findUnique>> | null

  if (overrideId) {
    acct = await prisma.gLAccount.findUnique({ where: { id: overrideId } })
    if (!acct) throw new Error(`Realized FX account not found for override id ${overrideId}`)
  } else {
    const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
    if (settings?.realizedFxAccountId) {
      acct = await prisma.gLAccount.findUnique({ where: { id: settings.realizedFxAccountId } })
    }
    if (!acct) {
      acct = await prisma.gLAccount.findFirst({ where: { accountNumber: '499' } })
    }
  }

  if (!acct) {
    throw new Error('No realized FX account (499) found in chart of accounts')
  }
  if (requireIncome && acct.accountClass !== 'income') {
    throw new Error(
      `Realized FX account ${acct.accountNumber} (${acct.accountName}) must be income-class, got '${acct.accountClass}'`
    )
  }
  return acct
}
