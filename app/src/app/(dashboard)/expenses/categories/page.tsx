export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import NewCategoryButton from '@/components/expense/NewCategoryButton'

export const metadata: Metadata = { title: 'Expense Categories' }

export default async function ExpenseCategoriesPage() {
  const categories = await prisma.expenseCategory.findMany({
    where: { isArchived: false },
    include: {
      glAccount: true,
      parent: true,
    },
    orderBy: [{ groupName: 'asc' }, { name: 'asc' }],
  })

  // Actual spend per category = posted JE-line activity on its GL account for
  // the year to date (debit − credit, expense accounts being debit-normal). The
  // old "Expenses" column counted Expense *records*, which is ~0 for most
  // categories since spend posts via bank-feed JEs/bills, not Expense records.
  // Spend lives at GL-account granularity, so categories sharing one account
  // show that account's total. The GL is maintained in CAD.
  const yearStart = new Date(new Date().getFullYear(), 0, 1)
  const glIds = [...new Set(categories.map((c) => c.glAccountId).filter((id): id is string => !!id))]
  const sums = glIds.length
    ? await prisma.journalEntryLine.groupBy({
        by: ['glAccountId'],
        where: {
          glAccountId: { in: glIds },
          journalEntry: { status: 'posted', entryDate: { gte: yearStart } },
        },
        _sum: { debit: true, credit: true },
      })
    : []
  const spendByAccount = new Map<string, number>()
  for (const s of sums) {
    if (!s.glAccountId) continue
    spendByAccount.set(s.glAccountId, Number(s._sum.debit ?? 0) - Number(s._sum.credit ?? 0))
  }

  const grouped = categories.reduce((acc, c) => {
    if (!acc[c.groupName]) acc[c.groupName] = []
    acc[c.groupName].push(c)
    return acc
  }, {} as Record<string, typeof categories>)

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Expense Categories
        </h1>
        <div className="flex items-center gap-4">
          <Link
            href="/expenses"
            className="text-sm text-[#0075DD] hover:underline"
          >
            ← Back to Expenses
          </Link>
          <NewCategoryButton />
        </div>
      </div>

      {Object.keys(grouped).length === 0 && (
        <div className="bg-white rounded-lg border border-[#E1E6EB] p-8 text-center">
          <p className="text-sm text-[#576981]">
            No expense categories yet. Click <strong>+ New Category</strong> to
            create your first one.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {Object.entries(grouped).map(([group, cats]) => (
          <div key={group} className="bg-white rounded-lg border border-[#E1E6EB] overflow-x-auto">
            <div className="px-4 py-3 bg-[#F5F7FA] border-b border-[#E1E6EB]">
              <h2 className="text-sm font-semibold text-[#001B40]">{group}</h2>
            </div>
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-[#FFFEFD] border-b border-[#E1E6EB]">
                  <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Category</th>
                  <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">Parent</th>
                  <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">GL Account</th>
                  <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981]">Spend (YTD)</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.id} className="border-t border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#001B40]">
                      {c.parent ? <span className="pl-4">↳ </span> : null}
                      {c.name}
                    </td>
                    <td className="px-4 py-1 text-sm text-[#576981]">{c.parent?.name || '—'}</td>
                    <td className="px-4 py-1 text-sm text-[#576981]">
                      {c.glAccount
                        ? `${c.glAccount.accountNumber} — ${c.glAccount.accountName}`
                        : '—'}
                    </td>
                    <td className="px-4 py-1 text-sm text-[#001B40] text-right">
                      {c.glAccountId ? formatCurrency(spendByAccount.get(c.glAccountId) ?? 0, 'CAD') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
