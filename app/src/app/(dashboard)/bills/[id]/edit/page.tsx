export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import BillForm from '@/components/bills/BillForm'

export default async function EditBillPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [bill, vendors, glAccounts, taxCodes] = await Promise.all([
    prisma.bill.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: 'asc' } } } }),
    prisma.vendor.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.gLAccount.findMany({
      where: { isArchived: false, accountClass: { in: ['expense', 'asset', 'liability'] } },
      orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    }),
    prisma.taxCode.findMany({ where: { isArchived: false }, orderBy: { code: 'asc' } }),
  ])
  if (!bill) return notFound()

  return (
    <BillForm
      mode="edit"
      bill={{
        id: bill.id,
        billNumber: bill.billNumber,
        vendorId: bill.vendorId,
        billDate: bill.billDate.toISOString(),
        dueDate: bill.dueDate.toISOString(),
        currency: bill.currency,
        notes: bill.notes,
        reference: bill.reference,
        status: bill.status,
        lines: bill.lines.map((l) => ({
          description: l.description,
          amount: Number(l.amount),
          taxAmount: Number(l.taxAmount),
          taxCodeId: l.taxCodeId,
          categoryGlAccountId: l.categoryGlAccountId,
        })),
      }}
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
