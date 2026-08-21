// Chart-of-accounts taxonomy: Account Type → Detail Type.
// Mirrors the conventional Canadian small-business account-type vocabulary so
// accounts imported from other accounting systems map 1:1.

export type InternalClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export interface DetailType {
  value: string
  label: string
}

export interface AccountType {
  /** Type label */
  type: string
  /** Our 5-class bucket */
  internalClass: InternalClass
  /** Whether accounts of this type are reconcilable by default */
  defaultReconcilable?: boolean
  detailTypes: DetailType[]
}

function dt(value: string): DetailType {
  return { value, label: value }
}

export const ACCOUNT_TYPES: AccountType[] = [
  {
    type: 'Bank',
    internalClass: 'asset',
    defaultReconcilable: true,
    detailTypes: [
      dt('Cash on hand'),
      dt('Chequing'),
      dt('Money Market'),
      dt('Rents Held in Trust'),
      dt('Savings'),
      dt('Trust account'),
    ],
  },
  {
    type: 'Accounts receivable (A/R)',
    internalClass: 'asset',
    detailTypes: [dt('Accounts Receivable (A/R)')],
  },
  {
    type: 'Current assets',
    internalClass: 'asset',
    detailTypes: [
      dt('Allowance for bad debts'),
      dt('Development Costs'),
      dt('Employee Cash Advances'),
      dt('Inventory'),
      dt('Investments - Other'),
      dt('Loans To Officers'),
      dt('Loans to Others'),
      dt('Loans to Shareholders'),
      dt('Other current assets'),
      dt('Prepaid Expenses'),
      dt('Retainage'),
      dt('Undeposited Funds'),
    ],
  },
  {
    type: 'Property, plant and equipment',
    internalClass: 'asset',
    detailTypes: [
      dt('Accumulated Amortization'),
      dt('Accumulated depletion'),
      dt('Accumulated Depreciation'),
      dt('Buildings'),
      dt('Depletable Assets'),
      dt('Furniture and Fixtures'),
      dt('Leasehold Improvements'),
      dt('Machinery and equipment'),
      dt('Other fixed assets'),
      dt('Vehicles'),
    ],
  },
  {
    type: 'Long-term Assets',
    internalClass: 'asset',
    detailTypes: [
      dt('Accumulated Amortization of Other Assets'),
      dt('Available-for-sale financial assets'),
      dt('Deferred tax'),
      dt('Goodwill'),
      dt('Intangible Assets'),
      dt('Investments'),
      dt('Lease Buyout'),
      dt('Licences'),
      dt('Organizational Costs'),
      dt('Other intangible assets'),
      dt('Other Long-term Assets'),
      dt('Prepayments and accrued income'),
      dt('Security Deposits'),
    ],
  },
  {
    type: 'Credit Card',
    internalClass: 'liability',
    defaultReconcilable: true,
    detailTypes: [dt('Credit Card')],
  },
  {
    type: 'Accounts payable (A/P)',
    internalClass: 'liability',
    detailTypes: [dt('Accounts Payable (A/P)')],
  },
  {
    type: 'Other Current Liabilities',
    internalClass: 'liability',
    detailTypes: [
      dt('Current Liabilities'),
      dt('Current portion of employee benefits obligations'),
      dt('Current portion of obligations under finance leases'),
      dt('Current Tax Liability'),
      dt('Insurance Payable'),
      dt('Interest payables'),
      dt('Line of Credit'),
      dt('Loan Payable'),
      dt('Payroll Clearing'),
      dt('Payroll liabilities'),
      dt('Prepaid Expenses Payable'),
      dt('Provision for warranty obligations'),
      dt('Rents in trust - Liability'),
      dt('Short term borrowings from related parties'),
      dt('Trust Accounts - Liabilities'),
    ],
  },
  {
    type: 'Long-term Liabilities',
    internalClass: 'liability',
    detailTypes: [
      dt('Accruals and Deferred Income'),
      dt('Bank loans'),
      dt('Long term borrowings'),
      dt('Long term employee benefit obligations'),
      dt('Notes Payable'),
      dt('Obligations under finance leases'),
      dt('Other Long Term Liabilities'),
      dt('Shareholder Notes Payable'),
    ],
  },
  {
    type: 'Equity',
    internalClass: 'equity',
    detailTypes: [
      dt('Accumulated adjustment'),
      dt('Common Stock'),
      dt('Opening Balance Equity'),
      dt("Owner's Equity"),
      dt('Paid-in capital or surplus'),
      dt('Partner Contributions'),
      dt('Partner Distributions'),
      dt("Partner's Equity"),
      dt('Preferred Stock'),
      dt('Retained Earnings'),
      dt('Share capital'),
      dt('Treasury Shares'),
    ],
  },
  {
    type: 'Income',
    internalClass: 'income',
    detailTypes: [
      dt('Discounts/Refunds Given'),
      dt('Non-Profit Income'),
      dt('Other Primary Income'),
      dt('Sales of Product Income'),
      dt('Service/Fee Income'),
      dt('Unapplied Cash Payment Income'),
    ],
  },
  {
    type: 'Other Income',
    internalClass: 'income',
    detailTypes: [
      dt('Dividend income'),
      dt('Gain/loss on sale of fixed assets'),
      dt('Gain/loss on sale of investments'),
      dt('Income'),
      dt('Interest earned'),
      dt('Other Investment Income'),
      dt('Tax-Exempt Interest'),
    ],
  },
  {
    type: 'Cost of Goods Sold',
    internalClass: 'expense',
    detailTypes: [
      dt('Cost of Goods Sold'),
      dt('Cost of Labour - COS'),
      dt('Equipment rental - COS'),
      dt('Other costs of service - COS'),
      dt('Shipping, Freight and Delivery - COS'),
      dt('Supplies and materials - COS'),
    ],
  },
  {
    type: 'Expenses',
    internalClass: 'expense',
    detailTypes: [
      dt('Advertising/Promotional'),
      dt('Auto'),
      dt('Bad debts'),
      dt('Bank charges'),
      dt('Charitable Contributions'),
      dt('Cost of Labour'),
      dt('Distribution costs'),
      dt('Dues and Subscriptions'),
      dt('Entertainment'),
      dt('Equipment rental'),
      dt('Insurance'),
      dt('Interest paid'),
      dt('Legal and professional fees'),
      dt('Meals and entertainment'),
      dt('Office/General Administrative Expenses'),
      dt('Other Miscellaneous Service Cost'),
      dt('Payroll Expenses'),
      dt('Promotional Meals'),
      dt('Rent or Lease of Buildings'),
      dt('Repair and maintenance'),
      dt('Shipping, Freight, and Delivery'),
      dt('Supplies'),
      dt('Taxes Paid'),
      dt('Travel'),
      dt('Travel meals'),
      dt('Unapplied Cash Bill Payment Expense'),
      dt('Utilities'),
    ],
  },
  {
    type: 'Other Expense',
    internalClass: 'expense',
    detailTypes: [
      dt('Amortization'),
      dt('Depreciation'),
      dt('Exchange Gain or Loss'),
      dt('Other Miscellaneous Expense'),
      dt('Penalties and settlements'),
    ],
  },
]

export function getTypeForDetailType(detailType: string): AccountType | null {
  for (const t of ACCOUNT_TYPES) {
    if (t.detailTypes.some((d) => d.value === detailType)) return t
  }
  return null
}

export function classFromType(typeLabel: string): InternalClass | null {
  return ACCOUNT_TYPES.find((t) => t.type === typeLabel)?.internalClass || null
}
