export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'
import BillPayClient from './BillPayClient'

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: { vendor: true, lines: true, payments: { orderBy: { paymentDate: 'desc' } } },
  })
  if (!bill) return notFound()

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    include: { glAccount: true },
    orderBy: [{ sortOrder: 'asc' }],
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/bills" className="text-[#0075DD] hover:underline">← Bills</Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <h1
            className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
            style={{ fontFamily: 'var(--font-heading)' }}
          >
            Bill {bill.billNumber}
          </h1>
          <p className="text-sm text-[#576981] mt-1">
            {bill.vendor?.name || '—'} · {formatDate(bill.billDate)} · due {formatDate(bill.dueDate)}
          </p>
        </div>
        <div className="text-right flex items-end gap-3">
          {(bill.status === 'draft' || bill.status === 'open') && (
            <Link
              href={`/bills/${bill.id}/edit`}
              className="px-4 py-2 text-sm font-medium text-[#001B40] bg-white border border-[#E1E6EB] rounded hover:bg-[#F5F7FA]"
            >
              Edit
            </Link>
          )}
          <div>
            <div className="text-xs text-[#576981] uppercase">Amount due</div>
            <div className="text-2xl font-semibold text-[#001B40]">
              {formatCurrency(Number(bill.amountDue), bill.currency, { includeCode: false })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E1E6EB]">
              <h2 className="text-sm font-semibold text-[#001B40]">Lines</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Description</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Amount</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Tax</th>
                </tr>
              </thead>
              <tbody>
                {bill.lines.map((l) => (
                  <tr key={l.id} className="border-t border-[#E1E6EB]">
                    <td className="px-3 py-2 text-[#001B40]">{l.description || '(no description)'}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(l.amount), bill.currency, { includeCode: false })}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(Number(l.taxAmount), bill.currency, { includeCode: false })}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#001B40] bg-[#F5F7FA]">
                  <td className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Total</td>
                  <td colSpan={2} className="px-3 py-2 text-right font-mono font-semibold text-[#001B40]">
                    {formatCurrency(Number(bill.total), bill.currency, { includeCode: false })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {bill.payments.length > 0 && (
            <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#E1E6EB]">
                <h2 className="text-sm font-semibold text-[#001B40]">Payments</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-[#F5F7FA]">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Method</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-[#576981]">Reference</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-[#576981]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.payments.map((p) => (
                    <tr key={p.id} className="border-t border-[#E1E6EB]">
                      <td className="px-3 py-2 text-[#001B40]">{formatDate(p.paymentDate)}</td>
                      <td className="px-3 py-2 text-[#001B40]">{p.paymentMethod}</td>
                      <td className="px-3 py-2 text-xs text-[#576981]">{p.reference || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-[#001B40]">
                        {formatCurrency(Number(p.amount), bill.currency, { includeCode: false })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {bill.notes && (
            <div className="bg-white rounded-lg border border-[#E1E6EB] p-4">
              <h3 className="text-xs font-semibold text-[#576981] uppercase mb-2">Notes</h3>
              <p className="text-sm text-[#001B40] whitespace-pre-wrap">{bill.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-[#E1E6EB] p-4">
            <h3 className="text-sm font-semibold text-[#001B40] mb-2">Status</h3>
            <div className="text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[#576981]">Total</span>
                <span className="font-mono">{formatCurrency(Number(bill.total), bill.currency, { includeCode: false })}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#576981]">Paid</span>
                <span className="font-mono">{formatCurrency(Number(bill.amountPaid), bill.currency, { includeCode: false })}</span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[#E1E6EB]">
                <span className="font-semibold text-[#001B40]">Outstanding</span>
                <span className="font-mono font-semibold">{formatCurrency(Number(bill.amountDue), bill.currency, { includeCode: false })}</span>
              </div>
            </div>
          </div>

          {bill.status !== 'paid' && bill.status !== 'void' && Number(bill.amountDue) > 0 && (
            <BillPayClient
              billId={bill.id}
              billNumber={bill.billNumber}
              currency={bill.currency}
              amountDue={Number(bill.amountDue)}
              bankAccounts={bankAccounts.map((b) => ({
                id: b.glAccountId,
                label: `${b.glAccount.accountNumber} ${b.glAccount.accountName}`,
                currency: b.glAccount.currency,
              }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}
