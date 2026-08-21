import type { Metadata } from 'next'
import ExpenseForm from '@/components/expense/ExpenseForm'

export const metadata: Metadata = { title: 'New Expense' }

export default function NewExpensePage() {
  return <ExpenseForm mode="new" />
}
