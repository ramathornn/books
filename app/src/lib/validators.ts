import { z } from 'zod'
import { isValidFiscalYearEnd } from '@/lib/fiscalYear'

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

export const setupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})

const lineItemSchema = z.object({
  title: z.string().default(''),
  description: z.string().default(''),
  rate: z.union([z.number(), z.string()]).transform((val) =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  quantity: z.union([z.number(), z.string()]).transform((val) =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ),
  taxCodes: z.array(z.string()).default([]),
}).refine(
  (data) => data.title.trim().length > 0 || data.description.trim().length > 0,
  { message: 'Item name or description is required', path: ['title'] }
)

export const invoiceSchema = z.object({
  clientId: z.string().min(1, 'Client is required'),
  // Optional explicit number (e.g. "407" or "0000407"); validated unique and
  // zero-padded. Omit to auto-assign the next sequential number.
  invoiceNumber: z.string().optional(),
  // Initial status: "draft" (default) or "sent". "sent" finalizes the invoice so
  // it becomes accruable (a bank match then posts A/R / Sales). Other statuses
  // are reached through their own flows, not on create.
  status: z.enum(['draft', 'sent']).optional(),
  currency: z.string().min(1).default('CAD'),
  dateIssued: z.string().or(z.date()),
  dateDue: z.string().or(z.date()),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
  description: z.string().default(''),
  reference: z.string().default(''),
  notes: z.string().default(''),
  terms: z.string().default(''),
  discount: z.union([z.number(), z.string()]).transform((val) =>
    typeof val === 'string' ? parseFloat(val) || 0 : val
  ).default(0),
  onlinePaymentsEnabled: z.boolean().optional(),
  allowPartialPayments: z.boolean().optional(),
})

export const estimateSchema = z.object({
  clientId: z.string().min(1, 'Client is required'),
  currency: z.string().min(1).default('CAD'),
  dateIssued: z.string().or(z.date()),
  lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
  description: z.string().default(''),
  notes: z.string().default(''),
  terms: z.string().default(''),
})

export const clientSchema = z.object({
  firstName: z.string().default(''),
  lastName: z.string().default(''),
  organization: z.string().default(''),
  email: z.string().email().or(z.literal('')).default(''),
  phone: z.string().default(''),
  address: z.string().default(''),
  country: z.string().default(''),
  vatId: z.string().default(''),
  currency: z.string().min(1).default('CAD'),
  internalNote: z.string().default(''),
}).refine(
  (data) => (data.firstName.trim() && data.lastName.trim()) || data.organization.trim(),
  { message: 'Either First and Last Name or Company Name is required', path: ['firstName'] }
)

export const itemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().default(''),
  rate: z.union([z.number(), z.string()]).transform((val) =>
    typeof val === 'string' ? parseFloat(val) : val
  ),
  taxes: z.string().default(''),
  category: z.string().default('service'),
})

export const paymentSchema = z.object({
  invoiceId: z.string().min(1, 'Invoice is required'),
  paymentDate: z.string().or(z.date()),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  amount: z.union([z.number(), z.string()]).transform((val) =>
    typeof val === 'string' ? parseFloat(val) : val
  ),
  notes: z.string().default(''),
})

// ---------- PHASE 2 ----------

export const expenseSchema = z.object({
  categoryId: z.string().min(1, 'Category is required'),
  vendorId: z.string().optional().nullable(),
  vendorName: z.string().optional(),
  // Legacy aliases — accepted but mapped to vendorId/vendorName before persisting.
  merchantId: z.string().optional().nullable(),
  merchantName: z.string().optional(),
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  taxCodeId: z.string().optional().nullable(),
  date: z.string().or(z.date()),
  amount: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === 'string' ? parseFloat(v) || 0 : v
  ),
  taxAmount: z.union([z.number(), z.string()]).transform((v) =>
    typeof v === 'string' ? parseFloat(v) || 0 : v
  ).default(0),
  currency: z.string().default('CAD'),
  description: z.string().default(''),
  notes: z.string().default(''),
  source: z.string().default(''),
  receiptUrl: z.string().default(''),
  isBillable: z.boolean().default(false),
  isRecurring: z.boolean().default(false),
  recurringFrequency: z.string().optional().nullable(),
  recurringEndDate: z.string().optional().nullable(),
})

export const timeEntrySchema = z.object({
  clientId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  serviceId: z.string().optional().nullable(),
  teamMemberId: z.string().optional().nullable(),
  date: z.string().or(z.date()),
  durationMinutes: z.number().int().positive(),
  description: z.string().default(''),
  notes: z.string().default(''),
  isBillable: z.boolean().default(true),
  isTimerBased: z.boolean().default(false),
  rate: z.union([z.number(), z.string()]).optional().nullable()
    .transform((v) => (v == null || v === '' ? null : typeof v === 'string' ? parseFloat(v) : v)),
  currency: z.string().default('CAD'),
})

export const projectSchema = z.object({
  name: z.string().min(1, 'Project name is required'),
  description: z.string().default(''),
  clientId: z.string().optional().nullable(),
  hourlyRate: z.union([z.number(), z.string()]).optional().nullable()
    .transform((v) => (v == null || v === '' ? null : typeof v === 'string' ? parseFloat(v) : v)),
  currency: z.string().default('CAD'),
})

export const serviceSchema = z.object({
  name: z.string().min(1, 'Service name is required'),
  description: z.string().default(''),
  hourlyRate: z.union([z.number(), z.string()]).optional().nullable()
    .transform((v) => (v == null || v === '' ? null : typeof v === 'string' ? parseFloat(v) : v)),
})

export const glAccountSchema = z.object({
  accountNumber: z.string().min(1, 'Account number is required'),
  accountName: z.string().min(1, 'Account name is required'),
  description: z.string().default(''),
  accountClass: z.enum(['asset', 'liability', 'equity', 'income', 'expense']),
  accountSubclass: z.string().default(''),
  detailType: z.string().optional().default(''),
  gifiCode: z.string().trim().optional().nullable(),
  parentId: z.string().optional().nullable(),
  currency: z.string().default('CAD'),
  isReconcilable: z.boolean().default(false),
  cashFlowSection: z.enum(['operating', 'investing', 'financing']).nullable().optional().default(null),
  openingBalance: z.union([z.number(), z.string()]).default(0)
    .transform((v) => (typeof v === 'string' ? parseFloat(v) || 0 : v)),
  openingBalanceDate: z.string().optional().nullable(),
})

// Journal-line money amount: non-negative, max 2 decimals. Sub-cent inputs
// would be rounded by Postgres (Decimal(15,2)) but applied unrounded to
// GLAccount.currentBalance, leaving a permanent drift between the two.
const journalAmountSchema = z.union([z.number(), z.string()]).default(0)
  .transform((v) => (typeof v === 'string' ? parseFloat(v) || 0 : v))
  .refine((v) => Number.isFinite(v) && v >= 0, {
    message: 'Amount must be a non-negative number',
  })
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'Amounts are limited to 2 decimal places',
  })

const journalLineSchema = z.object({
  glAccountId: z.string().min(1),
  description: z.string().default(''),
  debit: journalAmountSchema,
  credit: journalAmountSchema,
})

export const journalEntrySchema = z.object({
  entryDate: z.string().or(z.date()),
  description: z.string().default(''),
  memo: z.string().default(''),
  status: z.enum(['draft', 'posted']).default('draft'),
  lines: z.array(journalLineSchema).min(2, 'At least two lines are required'),
}).refine((data) => {
  const debit = data.lines.reduce((s, l) => s + (l.debit || 0), 0)
  const credit = data.lines.reduce((s, l) => s + (l.credit || 0), 0)
  return Math.abs(debit - credit) < 0.005
}, { message: 'Entry must be balanced (debit must equal credit)', path: ['lines'] })

export const expenseCategorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  groupName: z.string().default('Operating Expenses'),
  glAccountId: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
})

export type ExpenseInput = z.infer<typeof expenseSchema>
export type TimeEntryInput = z.infer<typeof timeEntrySchema>
export type ProjectInput = z.infer<typeof projectSchema>
export type ServiceInput = z.infer<typeof serviceSchema>
export type GLAccountInput = z.infer<typeof glAccountSchema>
export type JournalEntryInput = z.infer<typeof journalEntrySchema>
export type ExpenseCategoryInput = z.infer<typeof expenseCategorySchema>

export type LoginInput = z.infer<typeof loginSchema>
export type SetupInput = z.infer<typeof setupSchema>
export type InvoiceInput = z.infer<typeof invoiceSchema>
export type EstimateInput = z.infer<typeof estimateSchema>
export type ClientInput = z.infer<typeof clientSchema>
export type ItemInput = z.infer<typeof itemSchema>
export type PaymentInput = z.infer<typeof paymentSchema>

const str200 = z.string().max(200).optional()

export const companySettingsSchema = z.object({
  name: str200,
  legalName: str200,
  logoInitials: str200,
  addressLine1: str200,
  addressLine2: str200,
  city: str200,
  province: str200,
  postalCode: str200,
  country: str200,
  phone: str200,
  email: str200,
  website: str200,
  defaultCurrency: str200,
  defaultPaymentTerms: str200,
  // T2 (corporate) identifiers. Generic FORMATS only (never a specific value):
  // Alberta CAN = 10 numeric digits; BN + program account = 9 digits + 2 letters
  // + 4 digits (e.g. ...RC0001). Empty string clears the field.
  albertaCorporateAccountNumber: z
    .string()
    .max(20)
    .refine((v) => v === '' || /^\d{10}$/.test(v), 'Alberta CAN must be 10 digits')
    .optional(),
  t2ProgramAccount: z
    .string()
    .max(20)
    .refine((v) => v === '' || /^\d{9}[A-Za-z]{2}\d{4}$/.test(v), 'BN + program account must be 9 digits + 2 letters + 4 digits (e.g. ...RC0001)')
    .optional(),
  // Fiscal year-end (month 1-12 + day). Sent together or not at all; the
  // month/day combination is validated below, since neither is meaningful alone.
  fiscalYearEndMonth: z.number().int().min(1).max(12).optional(),
  fiscalYearEndDay: z.number().int().min(1).max(31).optional(),
})
  .refine(
    (v) =>
      (v.fiscalYearEndMonth === undefined) === (v.fiscalYearEndDay === undefined),
    { message: 'fiscalYearEndMonth and fiscalYearEndDay must be sent together', path: ['fiscalYearEndDay'] }
  )
  .refine(
    (v) =>
      v.fiscalYearEndMonth === undefined ||
      v.fiscalYearEndDay === undefined ||
      isValidFiscalYearEnd({ month: v.fiscalYearEndMonth, day: v.fiscalYearEndDay }),
    // e.g. Apr 31 or Feb 30. Feb 29 IS allowed — it clamps to the 28th in
    // non-leap years, which is the correct reading of "the last day of February".
    { message: 'That day does not exist in the selected month', path: ['fiscalYearEndDay'] }
  )

// ─── Forecasts ───────────────────────────────────────────────────────────────
const forecastSection = z.enum(['income', 'expense', 'debt'])
const forecastCellValue = z.union([z.number().finite(), z.string().max(500)])
const forecastName = z.string().trim().min(1).max(120).refine((s) => !s.startsWith('_'), 'Names cannot start with "_"')

export const forecastScenarioPatchSchema = z.object({
  name: forecastName.optional(),
  viewFrom: z.number().int().min(0).optional(),
  viewTo: z.number().int().min(0).optional(),
  monthCount: z.number().int().min(1).max(240).optional(),
})

export const forecastRowCreateSchema = z.object({
  section: forecastSection,
  name: forecastName,
  currency: z.enum(['CAD', 'USD', 'EUR']).optional(),
  categoryId: z.string().nullable().optional(),
})

export const forecastRowPatchSchema = z.object({
  name: forecastName.optional(),
  currency: z.enum(['CAD', 'USD', 'EUR']).optional(),
  hidden: z.boolean().optional(),
  categoryId: z.string().nullable().optional(),
  debtType: z.enum(['loan', 'simple']).optional(),
  interestRate: z.number().min(0).max(100).optional(),
  amortizationMonths: z.number().int().min(1).max(600).nullable().optional(),
  remainingMonths: z.number().int().min(1).max(600).nullable().optional(),
  linkedExpenseId: z.string().nullable().optional(),
  linkedAssetId: z.string().nullable().optional(),
})

export const forecastReorderSchema = z.object({
  section: forecastSection,
  categories: z.array(z.object({ id: z.string(), sortOrder: z.number().int() })).optional(),
  rows: z.array(z.object({ id: z.string(), sortOrder: z.number().int(), categoryId: z.string().nullable().optional() })),
})

export const forecastCellsSchema = z.object({
  cells: z.array(z.object({ rowId: z.string(), monthIndex: z.number().int().min(0).max(239), value: forecastCellValue })).min(1).max(500),
})

export const forecastCategorySchema = z.object({ name: forecastName })

export const forecastBankBalanceSchema = z.object({
  monthIndex: z.number().int().min(0).max(239),
  day: z.number().int().min(1).max(31).default(1),
  amount: z.number().finite(),
})

export const forecastFlowDaySchema = z.object({
  rowId: z.string(),
  monthIndex: z.number().int().min(0).max(239),
  day: z.union([z.number().int().min(1).max(31), z.literal('last')]),
  scope: z.enum(['month', 'onward']),
})

export const forecastAssetSchema = z.object({
  name: forecastName,
  type: z.enum(['property', 'vehicle', 'investment', 'cash', 'other']).default('other'),
  value: z.number().finite().default(0),
  linkedDebtId: z.string().nullable().optional(),
})
