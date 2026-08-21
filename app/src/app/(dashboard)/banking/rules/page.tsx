export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import RulesPageClient from './RulesPageClient'

export const metadata: Metadata = { title: 'Bank Rules' }

export default async function BankRulesPage() {
  const [rules, accounts, glAccounts, vendors, categories, taxCodes] = await Promise.all([
    prisma.bankRule.findMany({
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    }),
    prisma.bankAccount.findMany({
      where: { isArchived: false },
      include: { glAccount: true },
      orderBy: [{ sortOrder: 'asc' }],
    }),
    prisma.gLAccount.findMany({
      where: { isArchived: false, accountClass: { in: ['expense', 'income', 'liability', 'asset'] } },
      orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
    }),
    prisma.vendor.findMany({ where: { isArchived: false }, orderBy: { name: 'asc' } }),
    prisma.expenseCategory.findMany({ where: { isArchived: false }, orderBy: [{ groupName: 'asc' }, { name: 'asc' }] }),
    prisma.taxCode.findMany({ where: { isArchived: false }, orderBy: { code: 'asc' } }),
  ])

  return (
    <RulesPageClient
      initialRules={rules.map((r) => ({
        id: r.id,
        name: r.name,
        priority: r.priority,
        moneyDirection: r.moneyDirection,
        accountScope: r.accountScope,
        accountIds: r.accountIds,
        conditionLogic: r.conditionLogic,
        conditions: r.conditions as unknown,
        thenTransactionType: r.thenTransactionType,
        categoryGlAccountId: r.categoryGlAccountId,
        categoryId: r.categoryId,
        vendorId: r.vendorId,
        payee: r.payee,
        taxCodeId: r.taxCodeId,
        memo: r.memo,
        memoAppend: r.memoAppend,
        splits: r.splits as unknown,
        autoAdd: r.autoAdd,
        isActive: r.isActive,
      }))}
      bankAccounts={accounts.map((a) => ({
        id: a.id,
        label: `${a.glAccount.accountNumber} ${a.glAccount.accountName}`,
      }))}
      glAccounts={glAccounts.map((g) => ({
        id: g.id,
        accountNumber: g.accountNumber,
        accountName: g.accountName,
        accountClass: g.accountClass,
      }))}
      vendors={vendors.map((v) => ({ id: v.id, name: v.name }))}
      categories={categories.map((c) => ({ id: c.id, name: c.name, groupName: c.groupName }))}
      taxCodes={taxCodes.map((t) => ({ id: t.id, code: t.code, name: t.name }))}
    />
  )
}
