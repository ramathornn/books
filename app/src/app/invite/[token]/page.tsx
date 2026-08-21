import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import AcceptInviteClient from './AcceptInviteClient'

export const dynamic = 'force-dynamic'

// Public invite-acceptance page (allowlisted in src/proxy.ts by 64-hex token).
// The token is the credential; an invalid/expired/used one renders a dead end,
// never details about the account it pointed at.
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const company = await getCompanySettings()

  const invite = /^[a-f0-9]{64}$/.test(token)
    ? await prisma.userInvite.findUnique({ where: { token } })
    : null
  const valid = !!invite && !invite.acceptedAt && invite.expiresAt > new Date()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1A3353] to-[#2d5a8e] px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-lg shadow-xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-black text-[#1A3353] tracking-tight">
              {company.name.toUpperCase()}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{company.legalName}</p>
          </div>

          {valid ? (
            <AcceptInviteClient token={token} email={invite.email} role={invite.role} />
          ) : (
            <div className="text-center">
              <p className="text-sm text-gray-700">
                This invite link is invalid, expired, or has already been used.
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Ask the person who invited you to send a new link.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
