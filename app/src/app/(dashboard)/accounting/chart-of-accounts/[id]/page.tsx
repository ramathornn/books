export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import GLAccountForm from '@/components/accounting/GLAccountForm'

export default async function EditAccountPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [account, parents] = await Promise.all([
    prisma.gLAccount.findUnique({ where: { id } }),
    prisma.gLAccount.findMany({
      where: { isArchived: false, NOT: { id } },
      orderBy: { accountNumber: 'asc' },
      select: { id: true, accountNumber: true, accountName: true, accountClass: true },
    }),
  ])
  if (!account) return notFound()

  return (
    <GLAccountForm
      mode="edit"
      parents={parents}
      account={{
        id: account.id,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        description: account.description,
        accountClass: account.accountClass as 'asset' | 'liability' | 'equity' | 'income' | 'expense',
        accountSubclass: account.accountSubclass,
        detailType: account.detailType,
        gifiCode: account.gifiCode,
        cashFlowSection: account.cashFlowSection,
        parentId: account.parentId,
        currency: account.currency,
        isReconcilable: account.isReconcilable,
        openingBalance: Number(account.openingBalance),
        currentBalance: Number(account.currentBalance),
      }}
    />
  )
}
