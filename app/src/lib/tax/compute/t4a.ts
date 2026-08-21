import prisma from '@/lib/prisma'
import { round2 } from '@/lib/tax/round'

/**
 * T4A box computation — Box 048, "fees for services" paid to a subcontractor.
 *
 * Per the locked decision, the amount auto-pulls from Expense lines (and Bill
 * line items) tagged to a Vendor flagged `isContractor`, scoped to the
 * subcontractor-expense GL account (`CompanySettings.subcontractorExpenseAccountId`).
 * The `isContractor` flag is load-bearing: if the subcontractor account is shared
 * with non-T4A payees, only contractor-flagged vendors are included.
 *
 * Example: contractor fees totalling 12000.00 → Box 048 = 12000.00.
 *
 * `computeT4ABoxes` is the pure aggregation; `computeT4A` is the DB adapter.
 */

export interface T4ABoxes {
  box048?: number // fees for services (no GST/HST)
}

/** Pure: turn a summed fees total into the T4A box shape. */
export function computeT4ABoxes(feesForServices: number): T4ABoxes {
  return { box048: round2(feesForServices) }
}

export interface T4AComputeResult {
  boxes: T4ABoxes
  sourceRef: {
    subcontractorExpenseAccountId: string | null
    vendorId: string
    isContractor: boolean
    pulledTotal: number
    expenseIds: string[]
    billLineItemIds: string[]
    taxYear: number
  }
}

/**
 * DB adapter: sum `Expense.amount` + `BillLineItem.amount` for the given vendor
 * within the tax year, scoped to the subcontractor-expense account. Bill line
 * items are scoped by `categoryGlAccountId`; expenses don't carry a GL account
 * directly, so they're scoped via their category's GL account when that account
 * is the configured subcontractor account.
 */
export async function computeT4A({
  taxYear,
  vendorId,
  subcontractorExpenseAccountId,
}: {
  taxYear: number
  vendorId: string
  subcontractorExpenseAccountId?: string | null
}): Promise<T4AComputeResult> {
  let accountId = subcontractorExpenseAccountId ?? null
  if (!accountId) {
    const settings = await prisma.companySettings.findUnique({ where: { id: 'singleton' } })
    accountId = settings?.subcontractorExpenseAccountId ?? null
  }

  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, isContractor: true },
  })
  const isContractor = vendor?.isContractor ?? false

  const start = new Date(Date.UTC(taxYear, 0, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(taxYear, 11, 31, 23, 59, 59, 999))

  let pulledTotal = 0
  const expenseIds: string[] = []
  const billLineItemIds: string[] = []

  // Only contractor-flagged vendors contribute (account may be shared).
  if (isContractor) {
    // Expenses: scope to the subcontractor account via the category's GL
    // account. When no scoping account is configured, fall back to all of the
    // vendor's expenses in the year (single-account convention).
    const categoryFilter = accountId
      ? { category: { glAccountId: accountId } }
      : {}
    const expenses = await prisma.expense.findMany({
      where: {
        vendorId,
        isArchived: false,
        date: { gte: start, lte: end },
        ...categoryFilter,
      },
      select: { id: true, amount: true },
    })
    for (const e of expenses) {
      pulledTotal += Number(e.amount || 0)
      expenseIds.push(e.id)
    }

    // Bill line items: scope by the line's own GL account.
    const billLines = await prisma.billLineItem.findMany({
      where: {
        ...(accountId ? { categoryGlAccountId: accountId } : {}),
        bill: {
          vendorId,
          isArchived: false,
          status: { not: 'void' },
          billDate: { gte: start, lte: end },
        },
      },
      select: { id: true, amount: true },
    })
    for (const bl of billLines) {
      pulledTotal += Number(bl.amount || 0)
      billLineItemIds.push(bl.id)
    }
  }

  return {
    boxes: computeT4ABoxes(pulledTotal),
    sourceRef: {
      subcontractorExpenseAccountId: accountId,
      vendorId,
      isContractor,
      pulledTotal: round2(pulledTotal),
      expenseIds,
      billLineItemIds,
      taxYear,
    },
  }
}
