import { getCompanySettings } from '@/lib/company'
import EditInvoiceClient from './EditInvoiceClient'

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const company = await getCompanySettings()
  return <EditInvoiceClient params={params} company={company} />
}
