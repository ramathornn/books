export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import { formatCurrency, formatDate } from '@/lib/utils'

export const metadata: Metadata = { title: 'Bills' }

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  draft: { bg: '#F5F7FA', fg: '#576981' },
  open: { bg: '#FFF8E5', fg: '#996B00' },
  partial: { bg: '#FBE7E1', fg: '#BF2600' },
  paid: { bg: '#E6F4EA', fg: '#216E39' },
  void: { bg: '#F5F7FA', fg: '#8C9BAB' },
}

export default async function BillsPage() {
  const bills = await prisma.bill.findMany({
    where: { isArchived: false },
    include: { vendor: true },
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
  })

  const totals = bills.reduce(
    (acc, b) => {
      const amt = Number(b.amountDue)
      const overdue = b.status !== 'paid' && b.status !== 'void' && b.dueDate < new Date()
      if (b.status === 'paid') acc.paid += Number(b.total)
      if (b.status === 'open' || b.status === 'partial') acc.open += amt
      if (overdue) acc.overdue += amt
      return acc
    },
    { paid: 0, open: 0, overdue: 0 }
  )

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-[28px] sm:text-[40px] font-medium text-[#001B40]" style={{ fontFamily: 'var(--font-heading)' }}>
          Bills
        </h1>
        <Link
          href="/bills/new"
          className="px-4 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded inline-flex items-center"
        >
          + New Bill
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        <Stat label="Open A/P" value={formatCurrency(totals.open, 'CAD', { includeCode: false })} accent="#996B00" />
        <Stat label="Overdue" value={formatCurrency(totals.overdue, 'CAD', { includeCode: false })} accent="#BF2600" />
        <Stat label="Paid (lifetime)" value={formatCurrency(totals.paid, 'CAD', { includeCode: false })} accent="#216E39" />
      </div>

      <div className="bg-white rounded-lg border border-[#E1E6EB] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#E1E6EB]">
          <h2 className="text-sm font-semibold text-[#001B40]">{bills.length} bill{bills.length === 1 ? '' : 's'}</h2>
        </div>
        {bills.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-[#576981] mb-3">No bills yet.</p>
            <Link
              href="/bills/new"
              className="inline-block border-2 border-dashed border-[#E1E6EB] rounded-lg px-8 py-6 text-sm text-[#576981] hover:border-[#0075DD] hover:text-[#0075DD]"
            >
              + Create your first bill
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-[#F5F7FA]">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Bill #</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Vendor</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Bill date</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Due date</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Total</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-[#576981]">Due</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-[#576981]">Status</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => {
                  const overdue = b.status !== 'paid' && b.status !== 'void' && b.dueDate < new Date()
                  const colors = STATUS_COLORS[b.status] || STATUS_COLORS.draft
                  return (
                    <tr key={b.id} className="border-t border-[#E1E6EB] hover:bg-[#F5F7FA]/50">
                      <td className="px-3 py-2.5 text-sm font-mono text-[#0075DD]">
                        <Link href={`/bills/${b.id}`} className="hover:underline">
                          {b.billNumber}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-sm text-[#001B40]">{b.vendor?.name || '—'}</td>
                      <td className="px-3 py-2.5 text-sm text-[#001B40]">{formatDate(b.billDate)}</td>
                      <td className={`px-3 py-2.5 text-sm ${overdue ? 'text-[#BF2600] font-medium' : 'text-[#001B40]'}`}>
                        {formatDate(b.dueDate)}
                        {overdue && ' · overdue'}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-right font-mono text-[#001B40]">
                        {formatCurrency(Number(b.total), b.currency, { includeCode: false })}
                      </td>
                      <td className="px-3 py-2.5 text-sm text-right font-mono font-semibold text-[#001B40]">
                        {formatCurrency(Number(b.amountDue), b.currency, { includeCode: false })}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <span
                          className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase"
                          style={{ backgroundColor: colors.bg, color: colors.fg }}
                        >
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="bg-white rounded-lg border border-[#E1E6EB] p-4">
      <div className="text-[11px] text-[#576981] uppercase">{label}</div>
      <div className="text-xl font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
    </div>
  )
}
