export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/prisma'
import VendorsListClient from './VendorsListClient'

export const metadata: Metadata = { title: 'Vendors' }

export default async function VendorsPage() {
  const vendors = await prisma.vendor.findMany({
    where: { isArchived: false },
    include: {
      defaultCategory: true,
      _count: { select: { expenses: true } },
    },
    orderBy: { name: 'asc' },
  })

  const data = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    displayName: v.displayName,
    contactName: v.contactName,
    email: v.email,
    phone: v.phone,
    gstNumber: v.gstNumber,
    isContractor: v.isContractor,
    defaultCategoryName: v.defaultCategory?.name || '',
    expenseCount: v._count.expenses,
  }))

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1
          className="text-[28px] sm:text-[40px] font-medium text-[#001B40]"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          Vendors
        </h1>
        <Link
          href="/vendors/new"
          className="px-4 py-2 bg-[#038A06] hover:bg-[#026e05] text-white text-sm font-medium rounded inline-flex items-center"
        >
          + New Vendor
        </Link>
      </div>

      <VendorsListClient initialVendors={data} />
    </div>
  )
}
