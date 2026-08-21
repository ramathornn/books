import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import prisma from '@/lib/prisma'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await request.json()
  const t = await prisma.recurringTemplate.update({
    where: { id },
    data: {
      templateName: body.templateName !== undefined ? String(body.templateName) : undefined,
      transactionType: body.transactionType,
      intervalUnit: body.intervalUnit,
      intervalCount: body.intervalCount !== undefined ? parseInt(String(body.intervalCount), 10) : undefined,
      mode: body.mode,
      startDate: body.startDate ? new Date(String(body.startDate)) : undefined,
      endDate: body.endDate === '' || body.endDate === null ? null : body.endDate ? new Date(String(body.endDate)) : undefined,
      nextRunDate: body.nextRunDate === '' || body.nextRunDate === null ? null : body.nextRunDate ? new Date(String(body.nextRunDate)) : undefined,
      payload: body.payload,
      notes: body.notes,
      isActive: body.isActive !== undefined ? !!body.isActive : undefined,
    },
  })
  return Response.json(t)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  await prisma.recurringTemplate.delete({ where: { id } })
  return Response.json({ deleted: true })
}
