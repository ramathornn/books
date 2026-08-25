import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'
import Topbar from '@/components/layout/Topbar'
import { SidebarProvider } from '@/components/layout/SidebarContext'
import Toaster from '@/components/ui/Toaster'
import PasskeyEnrollPrompt from '@/components/PasskeyEnrollPrompt'
import { getCompanySettings } from '@/lib/company'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()
  if (!session?.user) {
    redirect('/login')
  }

  const company = await getCompanySettings()
  const readOnly = session.user.role === 'accountant'

  return (
    <SidebarProvider>
      <div className="min-h-screen bg-[#FFFEFD]">
        <Sidebar companyName={company.legalName} readOnly={readOnly} />
        <div className="lg:ml-[220px] flex flex-col min-h-screen bg-[#FFFEFD]">
          <Topbar readOnly={readOnly} userName={session.user.name ?? ""} />
          {readOnly && (
            <div className="bg-[#FFF7E6] border-b border-[#FFE0A3] px-4 sm:px-6 lg:px-8 py-2 text-center text-xs text-[#7A5800]">
              Read-only accountant access — you can view everything, but changes are disabled.
            </div>
          )}
          <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
            <div className="max-w-[1200px] mx-auto">{children}</div>
          </main>
        </div>
        <Toaster />
        <PasskeyEnrollPrompt />
      </div>
    </SidebarProvider>
  )
}
