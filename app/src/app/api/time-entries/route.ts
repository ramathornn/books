import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { timeEntrySchema } from '@/lib/validators'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = request.nextUrl.searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  const date = sp.get('date')
  const clientId = sp.get('clientId')
  const projectId = sp.get('projectId')
  const teamMemberId = sp.get('teamMemberId')
  const isBillable = sp.get('isBillable')

  const where: Record<string, unknown> = {}
  if (date) {
    const start = new Date(date)
    start.setHours(0, 0, 0, 0)
    const end = new Date(date)
    end.setHours(23, 59, 59, 999)
    where.date = { gte: start, lte: end }
  } else if (from || to) {
    const df: Record<string, Date> = {}
    if (from) df.gte = new Date(from)
    if (to) df.lte = new Date(to)
    where.date = df
  }
  if (clientId) where.clientId = clientId
  if (projectId) where.projectId = projectId
  if (teamMemberId) where.teamMemberId = teamMemberId
  if (isBillable != null) where.isBillable = isBillable === 'true'

  const entries = await prisma.timeEntry.findMany({
    where,
    include: {
      client: { select: { id: true, firstName: true, lastName: true, organization: true } },
      project: true,
      service: true,
      teamMember: true,
    },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  })
  return Response.json({ data: entries })
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const parsed = timeEntrySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const d = parsed.data
  const entry = await prisma.timeEntry.create({
    data: {
      date: new Date(d.date),
      durationMinutes: d.durationMinutes,
      description: d.description || '',
      notes: d.notes || '',
      isBillable: d.isBillable,
      isTimerBased: d.isTimerBased,
      rate: d.rate ?? undefined,
      currency: d.currency,
      clientId: d.clientId || null,
      projectId: d.projectId || null,
      serviceId: d.serviceId || null,
      teamMemberId: d.teamMemberId || null,
    },
    include: { client: true, project: true, service: true, teamMember: true },
  })
  return Response.json(entry, { status: 201 })
}
