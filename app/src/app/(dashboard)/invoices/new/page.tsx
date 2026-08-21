import { getCompanySettings } from '@/lib/company'
import NewInvoiceClient from './NewInvoiceClient'

export default async function NewInvoicePage() {
  const company = await getCompanySettings()
  return <NewInvoiceClient company={company} />
}
