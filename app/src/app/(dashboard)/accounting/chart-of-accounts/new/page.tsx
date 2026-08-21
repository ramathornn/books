import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import GLAccountForm from '@/components/accounting/GLAccountForm'

export const metadata: Metadata = { title: 'New Account' }

export default async function NewAccountPage() {
  const parents = await prisma.gLAccount.findMany({
    where: { isArchived: false },
    orderBy: { accountNumber: 'asc' },
    select: { id: true, accountNumber: true, accountName: true, accountClass: true },
  })
  return <GLAccountForm mode="new" parents={parents} />
}
