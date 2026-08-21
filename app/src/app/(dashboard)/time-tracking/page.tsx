export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import prisma from '@/lib/prisma'
import { getCompanySettings } from '@/lib/company'
import TimeTrackingClient from '@/components/time-tracking/TimeTrackingClient'

export const metadata: Metadata = { title: 'Time Tracking' }

export default async function TimeTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const view = typeof params.view === 'string' ? params.view : 'day'
  const dateParam = typeof params.date === 'string' ? params.date : undefined

  const [clients, projects, services, teamMembers, company] = await Promise.all([
    prisma.client.findMany({
      select: { id: true, firstName: true, lastName: true, organization: true },
      orderBy: [{ organization: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.project.findMany({
      where: { isArchived: false },
      select: { id: true, name: true, clientId: true, hourlyRate: true },
      orderBy: { name: 'asc' },
    }),
    prisma.service.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.teamMember.findMany({
      where: { status: 'active' },
      orderBy: { firstName: 'asc' },
    }),
    getCompanySettings(),
  ])

  return (
    <TimeTrackingClient
      initialView={view}
      initialDate={dateParam}
      companyName={company.name}
      clients={clients.map((c) => ({
        id: c.id,
        name: c.organization || `${c.firstName} ${c.lastName}`.trim(),
      }))}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        clientId: p.clientId,
        hourlyRate: p.hourlyRate ? Number(p.hourlyRate) : null,
      }))}
      services={services.map((s) => ({
        id: s.id,
        name: s.name,
        hourlyRate: s.hourlyRate ? Number(s.hourlyRate) : null,
      }))}
      teamMembers={teamMembers.map((t) => ({
        id: t.id,
        name: `${t.firstName} ${t.lastName}`.trim(),
      }))}
    />
  )
}
