export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { formatCurrency } from '@/lib/utils'
import ReportLayout from '@/components/reports/ReportLayout'

export const metadata: Metadata = { title: 'Bank Reconciliation Summary — Reports' }

export default async function BankReconciliationSummaryReport() {
  const banks = await prisma.bankAccount.findMany({
    include: { glAccount: true, transactions: true },
  })

  if (banks.length === 0) {
    return (
      <ReportLayout title="Bank Reconciliation Summary" rangeLabel="As of today" currentPreset="today">
        <div className="py-16 text-center">
          <svg className="w-24 h-24 mx-auto text-[#E1E6EB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M3 10l2-4h14l2 4M5 10v10h14V10" />
          </svg>
          <h3 className="mt-4 text-base font-semibold text-[#001B40]">
            Set an Opening Balance to Start Reconciling Your Transactions and View This Report
          </h3>
          <p className="mt-2 max-w-lg mx-auto text-sm text-[#576981]">
            Bank Reconciliation allows you to match your imported bank transactions with income and
            expenses tracked in Books.
          </p>
          <button className="mt-6 px-5 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded">
            Set your Opening Balance
          </button>
        </div>
      </ReportLayout>
    )
  }

  const currency = banks[0].glAccount.currency

  return (
    <ReportLayout title="Bank Reconciliation Summary" rangeLabel="As of today" currentPreset="today">
      <div className="space-y-6">
        {banks.map((b) => {
          const cleared = b.transactions.filter((t) => t.isReconciled)
          const uncleared = b.transactions.filter((t) => !t.isReconciled)
          const clearedSum = cleared.reduce((s, t) => s + Number(t.amount), 0)
          const unclearedSum = uncleared.reduce((s, t) => s + Number(t.amount), 0)
          return (
            <div key={b.id} className="border border-[#E1E6EB] rounded-lg overflow-hidden">
              <div className="bg-[#F5F7FA] px-4 py-2 text-base font-semibold text-[#001B40]">
                {b.bankName} — {b.glAccount.accountName}
              </div>
              <table className="w-full">
                <tbody>
                  <tr className="border-b border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#576981]">Cleared Transactions ({cleared.length})</td>
                    <td className="px-4 py-1 text-sm text-right font-semibold">
                      {formatCurrency(clearedSum, currency, { includeCode: false })}
                    </td>
                  </tr>
                  <tr className="border-b border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#576981]">Uncleared Transactions ({uncleared.length})</td>
                    <td className="px-4 py-1 text-sm text-right font-semibold">
                      {formatCurrency(unclearedSum, currency, { includeCode: false })}
                    </td>
                  </tr>
                  <tr className="border-b border-[#E1E6EB]">
                    <td className="px-4 py-1 text-sm text-[#576981]">Current Bank Balance</td>
                    <td className="px-4 py-1 text-sm text-right font-semibold">
                      {formatCurrency(Number(b.reconciledBalance), currency, { includeCode: false })}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-1 text-sm text-[#576981]">Books Balance</td>
                    <td className="px-4 py-1 text-sm text-right font-semibold">
                      {formatCurrency(Number(b.glAccount.currentBalance), currency, { includeCode: false })}
                    </td>
                  </tr>
                  <tr className="bg-[#F5F7FA] border-t-2 border-[#001B40]">
                    <td className="px-4 py-1 text-sm font-semibold">Difference</td>
                    <td className="px-4 py-1 text-sm text-right font-bold">
                      {formatCurrency(
                        Number(b.glAccount.currentBalance) - Number(b.reconciledBalance),
                        currency
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}
      </div>
    </ReportLayout>
  )
}
