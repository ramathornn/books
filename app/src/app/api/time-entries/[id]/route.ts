import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'
import { timeEntrySchema } from '@/lib/validators'

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  const body = await request.json()
  const parsed = timeEntrySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    )
  }
  const d = parsed.data
  const entry = await prisma.timeEntry.update({
    where: { id },
    data: {
      date: new Date(d.date),
      durationMinutes: d.durationMinutes,
      description: d.description || '',
      notes: d.notes || '',
      isBillable: d.isBillable,
      rate: d.rate ?? undefined,
      currency: d.currency,
      clientId: d.clientId || null,
      projectId: d.projectId || null,
      serviceId: d.serviceId || null,
      teamMemberId: d.teamMemberId || null,
    },
  })
  return Response.json(entry)
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params

  await prisma.timeEntry.delete({ where: { id } })
  return Response.json({ ok: true })
}
