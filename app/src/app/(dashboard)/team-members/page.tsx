export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import AddTeamMemberPanel from './AddTeamMemberPanel'
import InviteActions from './InviteActions'

export const metadata: Metadata = { title: 'Team Members' }

function roleLabel(role: string) {
  if (!role) return 'Employee'
  return role.charAt(0).toUpperCase() + role.slice(1).toLowerCase()
}

function initials(firstName: string, lastName: string) {
  const f = (firstName || '').trim().charAt(0).toUpperCase()
  const l = (lastName || '').trim().charAt(0).toUpperCase()
  return `${f}${l}` || '?'
}

const ACCESS_LABEL: Record<string, string> = {
  owner: 'Owner (full access)',
  accountant: 'Accountant (read-only)',
}

export default async function TeamMembersPage() {
  const [teamMembers, company, loginUsers, pendingInvites] = await Promise.all([
    prisma.teamMember.findMany({
      where: { status: 'active' },
      orderBy: { firstName: 'asc' },
    }),
    getCompanySettings(),
    prisma.user.findMany({ select: { email: true, role: true } }),
    prisma.userInvite.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, token: true },
    }),
  ])

  // Sign-in status per member, by email: an accepted login account wins over a
  // pending invite; most members have neither (no login).
  const userByEmail = new Map(loginUsers.map((u) => [u.email.toLowerCase(), u.role]))
  const inviteByEmail = new Map(pendingInvites.map((i) => [i.email.toLowerCase(), i]))

  const showPromo = teamMembers.length === 0

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Team Members</h1>
        <AddTeamMemberPanel />
      </div>

      {/* Promo cards — shown only when there are no non-owner members */}
      {showPromo && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-3xl mb-2" aria-hidden="true">
              👥
            </div>
            <div className="text-sm font-semibold text-gray-900 mb-1">
              Teams Make Collaboration Easier
            </div>
            <div className="text-xs text-gray-500 mb-3">
              Invite your team to work together on invoices, estimates, and
              projects.
            </div>
            <a href="#" className="text-xs font-medium text-[#038A06] hover:underline">
              Learn more
            </a>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-3xl mb-2" aria-hidden="true">
              ⏱️
            </div>
            <div className="text-sm font-semibold text-gray-900 mb-1">
              Team Time Tracking
            </div>
            <div className="text-xs text-gray-500 mb-3">
              Track hours across your team and bill clients accurately for
              every minute.
            </div>
            <a href="#" className="text-xs font-medium text-[#038A06] hover:underline">
              Learn more
            </a>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="text-3xl mb-2" aria-hidden="true">
              💸
            </div>
            <div className="text-sm font-semibold text-gray-900 mb-1">
              Run Payroll Effortlessly
            </div>
            <div className="text-xs text-gray-500 mb-3">
              Pay your team on time, every time, without the spreadsheet
              headaches.
            </div>
            <a href="#" className="text-xs font-medium text-[#038A06] hover:underline">
              Learn more
            </a>
          </div>
        </div>
      )}

      {/* Sub-heading */}
      <h2 className="text-sm font-medium text-gray-500 mb-3">
        All Team Members
      </h2>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Job Title
              </th>
              <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-4 py-1 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Account Access
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {/* Owner row — hardcoded */}
            <tr className="table-row-hover">
              <td className="px-4 py-1">
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                    style={{ backgroundColor: '#F5A623' }}
                  >
                    {company.logoInitials}
                  </div>
                  <div className="text-sm font-medium text-gray-900">
                    {company.name}
                  </div>
                </div>
              </td>
              <td className="px-4 py-1 text-sm text-gray-500">—</td>
              <td className="px-4 py-1 text-sm text-gray-900">Owner</td>
              <td className="px-4 py-1 text-sm text-gray-900">Owner (full access)</td>
            </tr>

            {teamMembers.map((member) => {
              const emailKey = (member.email || '').toLowerCase()
              const loginRole = userByEmail.get(emailKey)
              const pending = !loginRole ? inviteByEmail.get(emailKey) : undefined
              return (
              <tr key={member.id} className="table-row-hover">
                <td className="px-4 py-1">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 bg-[#1A3353]">
                      {initials(member.firstName, member.lastName)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {`${member.firstName} ${member.lastName}`.trim()}
                      </div>
                      {member.email && (
                        <div className="text-xs text-gray-500">
                          {member.email}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-1 text-sm text-gray-500">
                  {member.jobTitle || '—'}
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  {roleLabel(member.role)}
                </td>
                <td className="px-4 py-1 text-sm text-gray-900">
                  {loginRole ? (
                    ACCESS_LABEL[loginRole] ?? loginRole
                  ) : pending ? (
                    <>
                      <span className="text-gray-500">
                        Invite pending ({ACCESS_LABEL[pending.role]?.split(' ')[0] ?? pending.role})
                      </span>
                      <InviteActions inviteId={pending.id} token={pending.token} />
                    </>
                  ) : (
                    <span className="text-gray-400">No login</span>
                  )}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* View Deleted Team Members */}
      <div className="mt-6 text-center">
        <a
          href="#"
          className="text-sm text-gray-500 hover:text-gray-700 hover:underline"
        >
          View Deleted Team Members
        </a>
      </div>
    </div>
  )
}
