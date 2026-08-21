export interface BankTxRow {
  id: string
  bankAccountId: string
  transactionDate: string
  description: string
  amount: string | number
  status: string
  payee: string
  memo: string
  categoryId: string | null
  categoryGlAccountId: string | null
  vendorId: string | null
  taxCodeId: string | null
  journalEntryId: string | null
  matchedInvoiceId: string | null
  matchedPaymentId: string | null
  matchedExpenseId: string | null
  bankImportRuleId: string | null
  transferPairId: string | null
  isReconciled: boolean
}
