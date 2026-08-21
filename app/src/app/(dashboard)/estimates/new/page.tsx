import { getCompanySettings } from '@/lib/company'
import NewEstimateClient from './NewEstimateClient'

export default async function NewEstimatePage() {
  const company = await getCompanySettings()
  return <NewEstimateClient company={company} />
}
