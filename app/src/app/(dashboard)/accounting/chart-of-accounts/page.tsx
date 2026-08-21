export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import PrimaryButton from '@/components/ui/PrimaryButton'

export const metadata: Metadata = { title: 'Chart of Accounts' }

const TABS = [
  { value: '', label: 'All Accounts' },
  { value: 'asset', label: 'Asset' },
  { value: 'liability', label: 'Liability' },
  { value: 'equity', label: 'Equity' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
]

const CLASS_LABELS: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
}

export default async function ChartOfAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const classFilter = typeof params.class === 'string' ? params.class : ''

  const where: Record<string, unknown> = { isArchived: false }
  if (classFilter) where.accountClass = classFilter

  const accounts = await prisma.gLAccount.findMany({
    where,
    include: { parent: true },
    orderBy: [{ accountClass: 'asc' }, { accountNumber: 'asc' }],
  })

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <Link href="/accounting" className="text-xs text-[#0075DD] hover:underline">
            Accounting
          </Link>
          <h1 className="text-[28px] sm:text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
            Chart of Accounts
          </h1>
        </div>
        <PrimaryButton href="/accounting/chart-of-accounts/new">Add New Account</PrimaryButton>
      </div>

      <div className="border-b border-[#E1E6EB] mb-4">
        <div className="flex gap-6">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={`/accounting/chart-of-accounts${t.value ? `?class=${t.value}` : ''}`}
              className={`px-1 pb-2 text-sm font-medium border-b-2 -mb-px ${
                classFilter === t.value
                  ? 'text-[#001B40] border-[#0075DD]'
                  : 'text-[#576981] border-transparent hover:text-[#001B40]'
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-[#F5F7FA]">
            <tr>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981]">
                Account / Parent Account
              </th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-32">
                Account Number
              </th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-40">
                Account Type
              </th>
              <th className="px-4 py-1 text-left text-xs font-semibold text-[#576981] w-24">
                GIFI
              </th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981] w-40">
                Books Balance
              </th>
              <th className="px-4 py-1 text-right text-xs font-semibold text-[#576981] w-28">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-sm text-[#576981]">
                  No accounts found.
                </td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                  <td className="px-4 py-1 text-sm">
                    <Link href={`/accounting/chart-of-accounts/${a.id}`} className="text-[#001B40] hover:text-[#0075DD]">
                      {a.parent && <span className="pl-4">↳ </span>}
                      {a.accountName}
                    </Link>
                    {a.parent && (
                      <div className="text-xs text-[#576981] pl-4">Parent: {a.parent.accountName}</div>
                    )}
                  </td>
                  <td className="px-4 py-1 text-sm text-[#576981]">{a.accountNumber}</td>
                  <td className="px-4 py-1 text-sm text-[#576981]">
                    <div>{CLASS_LABELS[a.accountClass]}</div>
                    {a.accountSubclass && <div className="text-xs">{a.accountSubclass}</div>}
                  </td>
                  <td className="px-4 py-1 text-sm text-[#576981] font-mono">
                    {a.gifiCode || <span className="text-[#A6B0BD]">—</span>}
                  </td>
                  <td className="px-4 py-1 text-sm text-right font-semibold text-[#001B40]">
                    {formatCurrency(Number(a.currentBalance), a.currency)}
                  </td>
                  <td className="px-4 py-1 text-sm text-right">
                    <Link
                      href={`/accounting/chart-of-accounts/${a.id}/history`}
                      className="text-xs text-[#0075DD] hover:underline"
                    >
                      Account history
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
