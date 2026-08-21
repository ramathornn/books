export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import ExpenseForm from '@/components/expense/ExpenseForm'

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { category: true, vendor: true, client: true, project: true },
  })
  if (!expense) return notFound()

  // A receipt filed into the Files manager links back here; surface a jump link.
  const filed = await prisma.storedFile.findFirst({
    where: { expenseId: id },
    select: { id: true, folderId: true, folder: { select: { name: true } } },
  })
  const filedReceipt = filed
    ? { fileId: filed.id, folderId: filed.folderId, folderName: filed.folder?.name ?? 'Files' }
    : null

  return (
    <ExpenseForm
      mode="edit"
      filedReceipt={filedReceipt}
      expense={{
        id: expense.id,
        categoryId: expense.categoryId,
        vendorId: expense.vendorId,
        clientId: expense.clientId,
        projectId: expense.projectId,
        date: expense.date.toISOString(),
        amount: Number(expense.amount),
        taxAmount: Number(expense.taxAmount),
        currency: expense.currency,
        description: expense.description,
        notes: expense.notes,
        receiptUrl: expense.receiptUrl,
        isBillable: expense.isBillable,
        isRecurring: expense.isRecurring,
        recurringFrequency: expense.recurringFrequency,
      }}
    />
  )
}
