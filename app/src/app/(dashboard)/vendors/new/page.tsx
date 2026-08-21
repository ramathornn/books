import type { Metadata } from 'next'
import VendorForm from '@/components/vendor/VendorForm'

export const metadata: Metadata = { title: 'New Vendor' }

export default function NewVendorPage() {
  return <VendorForm mode="new" />
}
