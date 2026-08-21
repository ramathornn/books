export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import SalesTaxClient from './SalesTaxClient'

export const metadata: Metadata = { title: 'Sales Tax' }

export default async function SalesTaxPage() {
  const filings = await prisma.taxReturn.findMany({
    where: { type: 'GST/HST' },
    orderBy: { periodEnd: 'desc' },
    take: 12,
  })

  return (
    <div>
      <div className="text-sm mb-2">
        <Link href="/accounting" className="text-[#0075DD] hover:underline">← Accounting</Link>
      </div>
      <div className="mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Sales Tax
        </h1>
        <p className="text-sm text-[#576981] mt-1">
          Build a line-numbered GST34 worksheet (101/103/105/106/108/109) from the GL, copy the values into CRA GST/HST NETFILE, print the worksheet, mark filed, and post the remittance JE clearing GST Payable to GST Suspense.
        </p>
      </div>

      <SalesTaxClient
        filings={filings.map((f) => ({
          id: f.id,
          periodStart: f.periodStart.toISOString().slice(0, 10),
          periodEnd: f.periodEnd.toISOString().slice(0, 10),
          collected: Number(f.collectedAmount),
          paid: Number(f.paidAmount),
          net: Number(f.netAmount),
          status: f.status,
          filedAt: f.filedAt ? f.filedAt.toISOString().slice(0, 10) : null,
        }))}
      />
    </div>
  )
}
