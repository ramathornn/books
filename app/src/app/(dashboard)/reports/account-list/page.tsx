export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import { getCompanySettings } from '@/lib/company'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Account List — Reports' }

const CLASS_LABELS: Record<string, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
}

const CLASS_ORDER = ['asset', 'liability', 'equity', 'income', 'expense']

export default async function AccountListReport() {
  const [accounts, company] = await Promise.all([
    prisma.gLAccount.findMany({
      where: { isArchived: false },
      orderBy: [{ accountNumber: 'asc' }],
    }),
    getCompanySettings(),
  ])

  const grouped: Record<string, typeof accounts> = {}
  for (const a of accounts) {
    const k = a.accountClass
    if (!grouped[k]) grouped[k] = []
    grouped[k].push(a)
  }

  return (
    <ReportLayout
      title="Account List"
      breadcrumbHref="/reports"
      breadcrumbLabel="Reports"
      rangeLabel="Active accounts in the Chart of Accounts"
      currentPreset="this-year"
      companyName={company.legalName || company.name}
      showCompactToggle
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E1E6EB]">
            <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Number</th>
            <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Account name</th>
            <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Detail type</th>
            <th className="text-left py-1.5 px-2 text-xs font-semibold text-[#576981]">Currency</th>
            <th className="text-right py-1.5 px-2 text-xs font-semibold text-[#576981]">Current balance</th>
          </tr>
        </thead>
        <tbody>
          {CLASS_ORDER.filter((c) => grouped[c]?.length).map((cls) => {
            const items = grouped[cls]
            const total = items.reduce((s, a) => s + Number(a.currentBalance), 0)
            return (
              <>
                <tr key={`hdr-${cls}`} className="bg-[#F5F7FA]">
                  <td colSpan={5} className="py-2 px-2 text-sm font-semibold text-[#001B40]">
                    {CLASS_LABELS[cls]}
                  </td>
                </tr>
                {items.map((a) => (
                  <tr key={a.id} className="border-b border-[#E1E6EB]">
                    <td className="py-1 px-2 font-mono text-xs text-[#001B40]">{a.accountNumber}</td>
                    <td className="py-1 px-2 text-[#001B40]">{a.accountName}</td>
                    <td className="py-1 px-2 text-xs text-[#576981]">{a.detailType || a.accountSubclass || '—'}</td>
                    <td className="py-1 px-2 text-xs text-[#576981]">{a.currency}</td>
                    <td className="py-1 px-2 text-right font-mono text-[#001B40]">
                      {formatCurrency(Number(a.currentBalance), a.currency, { includeCode: false })}
                    </td>
                  </tr>
                ))}
                <tr key={`ttl-${cls}`} className="border-b-2 border-[#001B40]">
                  <td colSpan={4} className="py-1.5 px-2 text-xs font-semibold text-[#576981] text-right">
                    Total {CLASS_LABELS[cls]}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono font-semibold text-[#001B40]">
                    {formatCurrency(total, 'CAD', { includeCode: false })}
                  </td>
                </tr>
              </>
            )
          })}
        </tbody>
      </table>
    </ReportLayout>
  )
}
