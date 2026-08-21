export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import prisma from '@/lib/prisma'
import VendorForm from '@/components/vendor/VendorForm'

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: { defaultCategory: true },
  })
  if (!vendor) return notFound()

  return (
    <VendorForm
      mode="edit"
      vendor={{
        id: vendor.id,
        name: vendor.name,
        displayName: vendor.displayName,
        contactName: vendor.contactName,
        email: vendor.email,
        phone: vendor.phone,
        website: vendor.website,
        address: vendor.address,
        gstNumber: vendor.gstNumber,
        defaultCategoryId: vendor.defaultCategoryId,
        defaultTaxCodeId: vendor.defaultTaxCodeId,
        defaultPayee: vendor.defaultPayee,
        isContractor: vendor.isContractor,
        isArchived: vendor.isArchived,
      }}
    />
  )
}
