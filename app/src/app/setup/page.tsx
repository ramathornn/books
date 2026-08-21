import { redirect } from 'next/navigation'

// Setup is disabled — admin account is created via seed script.
export default function SetupPage() {
  redirect('/login')
}
