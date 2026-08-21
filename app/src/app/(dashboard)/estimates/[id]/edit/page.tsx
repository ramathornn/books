import { getCompanySettings } from '@/lib/company'
import EditEstimateClient from './EditEstimateClient'

export default async function EditEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const company = await getCompanySettings()
  return <EditEstimateClient params={params} company={company} />
}
