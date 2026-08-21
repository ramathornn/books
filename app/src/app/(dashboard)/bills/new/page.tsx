export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import BillForm from '@/components/bills/BillForm'

export const metadata: Metadata = { title: 'New Bill' }

export default async function NewBillPage() {
  const [vendors, glAccounts, taxCodes] = await Promise.all([
    prisma.vendor.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.gLAccount.findMany({
      where: { isArchived: false, accountClass: { in: ['expense', 'asset', 'liability'] } },
      orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    }),
    prisma.taxCode.findMany({ where: { isArchived: false }, orderBy: { code: 'asc' } }),
  ])

  return (
    <BillForm
      mode="new"
      vendors={vendors.map((v) => ({ id: v.id, name: v.name, defaultCategoryId: null, defaultTaxCodeId: v.defaultTaxCodeId }))}
      glAccounts={glAccounts.map((g) => ({
        id: g.id,
        accountNumber: g.accountNumber,
        accountName: g.accountName,
        accountClass: g.accountClass,
      }))}
      taxCodes={taxCodes.map((t) => ({ id: t.id, code: t.code, name: t.name, rate: Number(t.rate) }))}
    />
  )
}
