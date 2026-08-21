import { getCompanySettings } from '@/lib/company'
import LoginClient from './LoginClient'

export default async function LoginPage() {
  const company = await getCompanySettings()
  return (
    <LoginClient
      companyName={company.name}
      companyLegalName={company.legalName}
    />
  )
}
